import "server-only";

import { prisma } from "@/lib/prisma";
import { getEntitlementFor } from "@/lib/entitlement";
import {
  getLiveRcDriverNameSetting,
  getSpeedhiveTransponderLoanerSetting,
} from "@/lib/appSettings";
import { getSpeedhiveTransponderNumbersForUser } from "@/lib/speedhive/speedhiveDriverSettings";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";
import { resolveTrackTimeZone, timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";
import { readDoc, writeDoc } from "@/lib/sweep/blobStore";
import { SWEEP_DOC_VERSION, type SweepPlanDoc, type SweepPlanTrack, type SweepPlanUser } from "@/lib/sweep/sweepDocs";
import { isSweepListenerEmail, sweepListenerAllowlist } from "@/lib/sweep/sweepListeners";

export const PLAN_DOC_KEY = "plan.json";
const RACED_WITHIN_DAYS = 90;

/**
 * Who is listening, and where. Rebuilt nightly (and patched for one user when their identity
 * settings change) — the one DB-touching build the sweep does. A user listens when they are on
 * a paid, active tier AND have either a transponder (not loaner-flagged) or a LiveRC name.
 */
export async function buildSweepPlan(now = new Date()): Promise<{
  users: number;
  tracks: number;
}> {
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true, timeZone: true } });

  const users: Record<string, SweepPlanUser> = {};
  for (const u of allUsers) {
    const entry = await planUserEntry(u);
    if (entry) users[u.id] = entry;
  }
  const userIds = Object.keys(users);

  const chips: Record<string, string[]> = {};
  for (const u of Object.values(users)) {
    for (const chip of u.chips) {
      (chips[chip] ??= []).push(u.id);
    }
  }

  const tracks = await planTracksForUsers(userIds, now);

  // Per-track bookkeeping lives in its own document (`evening/<trackId>.json`), so the plan is
  // rebuilt from scratch and carries nothing over.
  const doc: SweepPlanDoc = {
    v: SWEEP_DOC_VERSION,
    builtIso: now.toISOString(),
    users,
    chips,
    tracks,
  };
  await writeDoc(PLAN_DOC_KEY, doc);
  return { users: userIds.length, tracks: Object.keys(tracks).length };
}

/** Patch one user's entry after a settings save, so a new chip listens the same day. */
export async function refreshPlanUser(userId: string): Promise<void> {
  const plan = await readDoc<SweepPlanDoc>(PLAN_DOC_KEY);
  if (!plan) return;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, timeZone: true },
  });
  if (!u) return;
  const entry = await planUserEntry(u);
  const before = plan.users[userId];
  if (before) {
    for (const chip of before.chips) {
      plan.chips[chip] = (plan.chips[chip] ?? []).filter((id) => id !== userId);
      if (plan.chips[chip]!.length === 0) delete plan.chips[chip];
    }
  }
  if (entry) {
    plan.users[userId] = entry;
    for (const chip of entry.chips) {
      const ids = plan.chips[chip] ?? [];
      if (!ids.includes(userId)) ids.push(userId);
      plan.chips[chip] = ids;
    }
  } else {
    delete plan.users[userId];
  }
  await writeDoc(PLAN_DOC_KEY, plan);
}

async function planUserEntry(u: {
  id: string;
  email: string | null;
  timeZone: string | null;
}): Promise<SweepPlanUser | null> {
  if (!isSweepListenerEmail(u.email, sweepListenerAllowlist())) return null;
  const entitlement = await getEntitlementFor(u.id, u.email);
  if (!entitlement.entitled) return null;
  const [transponders, loaner, liveRcName] = await Promise.all([
    getSpeedhiveTransponderNumbersForUser(u.id).catch(() => [] as number[]),
    getSpeedhiveTransponderLoanerSetting(u.id).catch(() => false),
    getLiveRcDriverNameSetting(u.id).catch(() => null),
  ]);
  const chips = loaner
    ? []
    : [...new Set(transponders.map((n) => normalizeSpeedhiveTransponderNumber(n)).filter((c): c is string => !!c))];
  const live = liveRcName?.trim() || null;
  if (chips.length === 0 && !live) return null;
  return { id: u.id, email: u.email, timeZone: u.timeZone, chips, liveRcName: live, tier: entitlement.tier };
}

async function planTracksForUsers(userIds: string[], now: Date): Promise<Record<string, SweepPlanTrack>> {
  if (userIds.length === 0) return {};
  const since = new Date(now.getTime() - RACED_WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const pairs = await prisma.run.findMany({
    where: { userId: { in: userIds }, trackId: { not: null }, sortAt: { gte: since } },
    select: { userId: true, trackId: true },
    distinct: ["userId", "trackId"],
  });
  const usersByTrack = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.trackId) continue;
    (usersByTrack.get(p.trackId) ?? usersByTrack.set(p.trackId, new Set()).get(p.trackId)!).add(p.userId);
  }
  const trackIds = [...usersByTrack.keys()];
  if (trackIds.length === 0) return {};
  const rows = await prisma.track.findMany({
    where: {
      id: { in: trackIds },
      OR: [{ speedhiveUrl: { not: null } }, { liveRcUrl: { not: null } }],
    },
    select: {
      id: true,
      name: true,
      speedhiveUrl: true,
      liveRcUrl: true,
      timeZone: true,
      latitude: true,
      longitude: true,
      user: { select: { timeZone: true } },
    },
  });
  const out: Record<string, SweepPlanTrack> = {};
  for (const t of rows) {
    if (!t.timeZone) {
      const fromPin = timeZoneForCoordinates(t.latitude, t.longitude);
      if (fromPin) {
        await prisma.track.update({ where: { id: t.id }, data: { timeZone: fromPin } });
        t.timeZone = fromPin;
      }
    }
    out[t.id] = {
      id: t.id,
      name: t.name,
      speedhiveUrl: t.speedhiveUrl,
      liveRcUrl: t.liveRcUrl,
      timeZone: resolveTrackTimeZone(t, t.user),
      userIds: [...(usersByTrack.get(t.id) ?? [])],
    };
  }
  return out;
}

