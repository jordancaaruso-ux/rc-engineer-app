import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getKnownCompetitorsSetting, getLiveRcDriverNameSetting, getMyNameSetting } from "@/lib/appSettings";
import { parseKnownCompetitorsSetting } from "@/lib/speedhive/knownCompetitors";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { parseSpeedhivePracticeActivityRef } from "@/lib/speedhive/speedhivePracticeUrl";
import {
  nameImportedSessions,
  type SessionName,
  type SessionNamingRow,
  type SessionNamingViewer,
} from "@/lib/lapImport/sessionNaming";

/**
 * Names for imported sessions, worked out with everything the pure namer can't see for itself:
 * who the viewer is, which track a session was at, and the rest of each session's day.
 *
 * Select these fields on any row you want named.
 */
export const SESSION_NAMING_SELECT = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  sourceUrl: true,
  parserId: true,
  parsedPayload: true,
  eventDetectionSource: true,
  eventDetectionSessionLabel: true,
  eventRaceClass: true,
  customName: true,
  sweepChipCode: true,
  linkedRunId: true,
  track: { select: { name: true } },
  linkedRun: { select: { trackNameSnapshot: true, track: { select: { name: true } } } },
  linkedEvent: { select: { track: { select: { name: true } } } },
} satisfies Prisma.ImportedLapTimeSessionSelect;

export type SessionNamingDbRow = Prisma.ImportedLapTimeSessionGetPayload<{
  select: typeof SESSION_NAMING_SELECT;
}>;

/** A day either side of a session covers any track's clock against UTC. */
const DAY_SLACK_MS = 36 * 60 * 60 * 1000;

/** Who the viewer is, as every timing site might print them. */
export async function loadSessionNamingViewer(userId: string): Promise<SessionNamingViewer> {
  const [speedhiveNames, liveRcName, myName, transponders, savedRaw, user] = await Promise.all([
    getSpeedhiveDriverNamesForUser(userId).catch(() => [] as string[]),
    getLiveRcDriverNameSetting(userId).catch(() => null),
    getMyNameSetting(userId).catch(() => null),
    getSpeedhiveTransponderNumbersForUser(userId).catch(() => [] as number[]),
    getKnownCompetitorsSetting(userId).catch(() => null),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }).catch(() => null),
  ]);
  const firstLiveRc = (liveRcName ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null;
  return {
    names: [...speedhiveNames, liveRcName ?? "", myName ?? ""].filter(Boolean),
    displayName: myName?.trim() || user?.name?.trim() || firstLiveRc || speedhiveNames[0]?.trim() || null,
    transponders,
    saved: parseKnownCompetitorsSetting(savedRaw),
  };
}

function hostOf(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const u = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

function hintString(parsedPayload: unknown, key: string): string | null {
  if (!parsedPayload || typeof parsedPayload !== "object") return null;
  const hint = (parsedPayload as { sessionHint?: unknown }).sessionHint;
  if (!hint || typeof hint !== "object") return null;
  const v = (hint as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The track each LiveRC club site belongs to. The catalog already pairs about a thousand clubs
 * with their LiveRC address; a track the viewer made themselves wins over the catalog's copy.
 * Other drivers' private tracks are never read.
 */
async function trackNamesByLiveRcHost(userId: string, hosts: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (hosts.length === 0) return out;
  const tracks = await prisma.track.findMany({
    where: {
      AND: [
        { OR: hosts.map((h) => ({ liveRcUrl: { contains: h, mode: "insensitive" as const } })) },
        { OR: [{ catalogSource: { not: null } }, { userId }] },
      ],
    },
    select: { name: true, liveRcUrl: true, userId: true },
    take: 200,
  });
  const own = new Map<string, string>();
  for (const t of tracks) {
    const host = hostOf(t.liveRcUrl);
    const name = t.name?.trim();
    if (!host || !name || !hosts.includes(host)) continue;
    if (t.userId === userId) own.set(host, name);
    else if (!out.has(host)) out.set(host, name);
  }
  for (const [host, name] of own) out.set(host, name);
  return out;
}

/** MYLAPS practice location id in a track's Speedhive link: "speedhive.mylaps.com/practice/4591". */
function speedhiveLocationOf(url: string | null | undefined): number | null {
  const m = url?.match(/\/practice\/(\d+)(?:\/|$|\?)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The track each MYLAPS practice location belongs to — same rules as the LiveRC lookup above. */
async function trackNamesBySpeedhiveLocation(userId: string, locations: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (locations.length === 0) return out;
  const tracks = await prisma.track.findMany({
    where: {
      AND: [
        { OR: locations.map((l) => ({ speedhiveUrl: { contains: `/practice/${l}` } })) },
        { OR: [{ catalogSource: { not: null } }, { userId }] },
      ],
    },
    select: { name: true, speedhiveUrl: true, userId: true },
    take: 200,
  });
  const own = new Map<number, string>();
  for (const t of tracks) {
    const loc = speedhiveLocationOf(t.speedhiveUrl);
    const name = t.name?.trim();
    if (!loc || !name || !locations.includes(loc)) continue;
    if (t.userId === userId) own.set(loc, name);
    else if (!out.has(loc)) out.set(loc, name);
  }
  for (const [loc, name] of own) out.set(loc, name);
  return out;
}

/** The columns the track lookup reads — a subset of {@link SESSION_NAMING_SELECT}. */
export type SessionTrackRow = Pick<
  SessionNamingDbRow,
  "id" | "sourceUrl" | "parsedPayload" | "track" | "linkedRun" | "linkedEvent"
>;

function trackNameOf(
  row: SessionTrackRow,
  byHost: Map<string, string>,
  byLocation: Map<number, string>
): string | null {
  const host = hostOf(row.sourceUrl);
  const location = parseSpeedhivePracticeActivityRef(row.sourceUrl)?.locationId ?? null;
  return (
    row.track?.name?.trim() ||
    row.linkedEvent?.track?.name?.trim() ||
    row.linkedRun?.track?.name?.trim() ||
    row.linkedRun?.trackNameSnapshot?.trim() ||
    hintString(row.parsedPayload, "practiceTrackName") ||
    (host && host.endsWith(".liverc.com") ? byHost.get(host) : null) ||
    (location ? byLocation.get(location) : null) ||
    // No track of ours matches: the timing site's own name for the location beats "MYLAPS".
    hintString(row.parsedPayload, "practiceLocationName") ||
    null
  );
}

/**
 * Which track each session was at: the sweep's, a linked run's or event's, the practice list's,
 * or the club whose LiveRC address or MYLAPS location matches; null when none of ours does. The
 * lap sheet scopes every comparison by this (same track only — founder call, 2026-09-24), so the
 * pickers read it for every session, not just the ones on a run.
 */
export async function loadSessionTrackNames(
  userId: string,
  rows: readonly SessionTrackRow[]
): Promise<Map<string, string | null>> {
  const hosts = [
    ...new Set(
      rows
        .map((r) => hostOf(r.sourceUrl))
        .filter((h): h is string => !!h && h.endsWith(".liverc.com"))
    ),
  ];
  const locations = [
    ...new Set(
      rows
        .map((r) => parseSpeedhivePracticeActivityRef(r.sourceUrl)?.locationId ?? null)
        .filter((l): l is number => l != null)
    ),
  ];
  const [byHost, byLocation] = await Promise.all([
    trackNamesByLiveRcHost(userId, hosts),
    trackNamesBySpeedhiveLocation(userId, locations),
  ]);
  return new Map(rows.map((r) => [r.id, trackNameOf(r, byHost, byLocation)]));
}

function toNamingRow(row: SessionNamingDbRow, trackName: string | null): SessionNamingRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    sessionCompletedAt: row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null,
    sourceUrl: row.sourceUrl,
    parserId: row.parserId,
    parsedPayload: row.parsedPayload,
    eventDetectionSource: row.eventDetectionSource,
    eventDetectionSessionLabel: row.eventDetectionSessionLabel,
    eventRaceClass: row.eventRaceClass,
    customName: row.customName,
    sweepChipCode: row.sweepChipCode,
    linkedRunId: row.linkedRunId,
    trackName,
  };
}

/** Collapse each session's day (with slack) into as few time ranges as cover them all. */
function dayRanges(rows: readonly SessionNamingDbRow[]): Array<{ from: Date; to: Date }> {
  const spans = rows
    .map((r) => (r.sessionCompletedAt ?? r.createdAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
    .map((t) => ({ from: t - DAY_SLACK_MS, to: t + DAY_SLACK_MS }));
  const merged: Array<{ from: number; to: number }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  return merged.map((m) => ({ from: new Date(m.from), to: new Date(m.to) }));
}

/**
 * Name `rows`. The rest of each session's day is read too — deleted sessions included, since they
 * still happened — so "Run 3" means the third time on track whichever sessions are on screen.
 */
export async function loadSessionNames(params: {
  userId: string;
  rows: readonly SessionNamingDbRow[];
  /** The viewer's zone, for the rare session whose only time is when it was imported. */
  timeZone: string | null;
  viewer?: SessionNamingViewer;
  now?: Date;
}): Promise<Map<string, SessionName>> {
  const { userId, rows } = params;
  if (rows.length === 0) return new Map();

  const ranges = dayRanges(rows);
  const shownIds = rows.map((r) => r.id);
  const [viewer, siblings] = await Promise.all([
    params.viewer ?? loadSessionNamingViewer(userId),
    ranges.length > 0
      ? prisma.importedLapTimeSession.findMany({
          where: {
            userId,
            id: { notIn: shownIds },
            OR: ranges.map((r) => ({ sessionCompletedAt: { gte: r.from, lte: r.to } })),
          },
          select: SESSION_NAMING_SELECT,
          take: 1000,
        })
      : Promise.resolve([] as SessionNamingDbRow[]),
  ]);

  const all = [...rows, ...siblings];
  const tracks = await loadSessionTrackNames(userId, all);

  const named = nameImportedSessions(
    all.map((r) => toNamingRow(r, tracks.get(r.id) ?? null)),
    viewer,
    { timeZone: params.timeZone, now: params.now }
  );
  const out = new Map<string, SessionName>();
  for (const id of shownIds) {
    const n = named.get(id);
    if (n) out.set(id, n);
  }
  return out;
}
