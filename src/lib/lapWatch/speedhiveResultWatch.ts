import "server-only";

import { prisma } from "@/lib/prisma";
import { discoverSpeedhiveSessionsForUser } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";
import { hasSpeedhiveIdentityForUser } from "@/lib/speedhive/speedhiveDriverSettings";
import { sendPushToUser } from "@/lib/webPush/server";

/**
 * Speedhive result watcher (flagship Stage 2). Speedhive is the universal trigger:
 * when the user's transponder completes a session it shows up here, and we push
 * "new run — tap to log it". We NEVER auto-import; the tap opens Add Run (Stage 3).
 *
 * Windowing: only users participating in an event active *today* at a Speedhive-enabled
 * track are polled (cheap — usually zero). Dedup: a per-user set of already-notified
 * session URLs in AppSetting, plus a freshness window so activating mid-day doesn't
 * replay old sessions.
 */

const NOTIFIED_URLS_KEY = "speedhive_result_watch_notified_urls";
const FRESHNESS_HOURS = 4;
const MAX_TRACKED_URLS = 120;
const MAX_USERS_PER_RUN = 100;

export type ResultWatchTarget = {
  userId: string;
  speedhiveUrl: string;
  trackName: string | null;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Users to poll now: participants in a Speedhive-enabled event active today. */
export async function getResultWatchTargets(now: Date): Promise<ResultWatchTarget[]> {
  const events = await prisma.event.findMany({
    where: {
      startDate: { lte: endOfDay(now) },
      endDate: { gte: startOfDay(now) },
      track: { speedhiveUrl: { not: null } },
    },
    select: {
      track: { select: { name: true, speedhiveUrl: true } },
      participations: { select: { userId: true } },
    },
  });

  const byKey = new Map<string, ResultWatchTarget>();
  for (const ev of events) {
    const url = ev.track?.speedhiveUrl?.trim();
    if (!url) continue;
    for (const p of ev.participations) {
      const key = `${p.userId}::${url}`;
      if (!byKey.has(key)) {
        byKey.set(key, { userId: p.userId, speedhiveUrl: url, trackName: ev.track?.name ?? null });
      }
    }
  }
  return [...byKey.values()];
}

async function getNotifiedSet(userId: string): Promise<Set<string>> {
  const row = await prisma.appSetting.findUnique({
    where: { userId_key: { userId, key: NOTIFIED_URLS_KEY } },
    select: { value: true },
  });
  if (!row?.value) return new Set();
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveNotifiedSet(userId: string, set: Set<string>): Promise<void> {
  const arr = [...set].slice(-MAX_TRACKED_URLS);
  const value = JSON.stringify(arr);
  await prisma.appSetting.upsert({
    where: { userId_key: { userId, key: NOTIFIED_URLS_KEY } },
    create: { userId, key: NOTIFIED_URLS_KEY, value },
    update: { value },
  });
}

export async function checkSpeedhiveResultsForUser(
  target: ResultWatchTarget,
  now: Date,
): Promise<{ newCount: number; notified: boolean }> {
  if (!(await hasSpeedhiveIdentityForUser(target.userId))) {
    return { newCount: 0, notified: false };
  }

  const discovery = await discoverSpeedhiveSessionsForUser({
    userId: target.userId,
    trackSpeedhiveUrl: target.speedhiveUrl,
  });

  const notifiedSet = await getNotifiedSet(target.userId);
  const freshCutoff = now.getTime() - FRESHNESS_HOURS * 60 * 60 * 1000;

  // Candidates are matched-to-user sessions, newest-first. Notify the ones that are
  // not already logged, not already notified, and completed within the freshness window.
  const fresh = discovery.candidates.filter((c) => {
    if (c.alreadyImported) return false;
    if (notifiedSet.has(c.sessionUrl)) return false;
    const t = c.sessionCompletedAtIso ? new Date(c.sessionCompletedAtIso).getTime() : NaN;
    if (Number.isNaN(t)) return false;
    return t >= freshCutoff;
  });

  if (fresh.length === 0) return { newCount: 0, notified: false };

  for (const c of fresh) notifiedSet.add(c.sessionUrl);
  await saveNotifiedSet(target.userId, notifiedSet);

  const newest = fresh[0];
  const title = target.trackName ? `New run at ${target.trackName}` : "New run completed";
  const body =
    fresh.length > 1
      ? `${fresh.length} new sessions with your transponder — tap to log them.`
      : `${newest.label || "Session"} — tap to log this run.`;
  // Tap → import this session (on demand, never auto) → Add Run link-or-new flow.
  const url = `/api/laps/import-and-log?session=${encodeURIComponent(newest.sessionUrl)}`;

  const res = await sendPushToUser(target.userId, {
    title,
    body,
    url,
    tag: "jrc-new-result",
  });

  return { newCount: fresh.length, notified: res.sent > 0 };
}

export async function runResultWatch(
  now: Date,
): Promise<{ targets: number; usersNotified: number; totalNew: number }> {
  const targets = (await getResultWatchTargets(now)).slice(0, MAX_USERS_PER_RUN);
  let usersNotified = 0;
  let totalNew = 0;

  for (const target of targets) {
    try {
      const r = await checkSpeedhiveResultsForUser(target, now);
      if (r.notified) usersNotified += 1;
      totalNew += r.newCount;
    } catch (err) {
      console.warn(
        "[result-watch] user check failed",
        JSON.stringify({ userId: target.userId, error: err instanceof Error ? err.message : String(err) }),
      );
    }
  }

  return { targets: targets.length, usersNotified, totalNew };
}
