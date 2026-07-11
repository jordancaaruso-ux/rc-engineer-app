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

export type ResultCheckReport = {
  matched: number;
  fresh: number;
  notified: boolean;
  sent: number;
  hint: string | null;
};

/** Deep-link a session URL to the on-demand import + Add Run flow (never auto-imports). */
function tapUrlForSession(sessionUrl: string): string {
  return `/api/laps/import-and-log?session=${encodeURIComponent(sessionUrl)}`;
}

export async function checkSpeedhiveResultsForUser(
  target: ResultWatchTarget,
  now: Date,
): Promise<ResultCheckReport> {
  if (!(await hasSpeedhiveIdentityForUser(target.userId))) {
    return { matched: 0, fresh: 0, notified: false, sent: 0, hint: "No Speedhive transponder / driver name set." };
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

  if (fresh.length === 0) {
    return {
      matched: discovery.candidates.length,
      fresh: 0,
      notified: false,
      sent: 0,
      hint: discovery.hint,
    };
  }

  for (const c of fresh) notifiedSet.add(c.sessionUrl);
  await saveNotifiedSet(target.userId, notifiedSet);

  const newest = fresh[0];
  const title = target.trackName ? `New run at ${target.trackName}` : "New run completed";
  const body =
    fresh.length > 1
      ? `${fresh.length} new sessions with your transponder — tap to log them.`
      : `${newest.label || "Session"} — tap to log this run.`;

  const res = await sendPushToUser(target.userId, {
    title,
    body,
    url: tapUrlForSession(newest.sessionUrl),
    tag: "jrc-new-result",
  });

  return {
    matched: discovery.candidates.length,
    fresh: fresh.length,
    notified: res.sent > 0,
    sent: res.sent,
    hint: null,
  };
}

export type WatchTestReport = {
  mode: "check" | "force";
  speedhiveUrl: string;
  matched: number;
  fresh?: number;
  pushed: boolean;
  sent: number;
  newestLabel: string | null;
  note: string;
};

/**
 * On-demand test of the detection pipeline for the current user against a specific
 * Speedhive URL — bypasses the active-event-day gate. `check` runs the real logic
 * (dedup + 4h freshness, persists). `force` pushes the newest matched session
 * regardless of dedup/freshness and does NOT persist, so it can be repeated.
 */
export async function runWatchTest(
  input: { userId: string; speedhiveUrl: string; force: boolean },
  now: Date,
): Promise<WatchTestReport> {
  const { userId, speedhiveUrl, force } = input;

  if (force) {
    const discovery = await discoverSpeedhiveSessionsForUser({
      userId,
      trackSpeedhiveUrl: speedhiveUrl,
    });
    const newest = discovery.candidates[0] ?? null;
    if (!newest) {
      return {
        mode: "force",
        speedhiveUrl,
        matched: discovery.candidates.length,
        pushed: false,
        sent: 0,
        newestLabel: null,
        note: discovery.hint ?? "No sessions matched your transponder / driver name at this URL.",
      };
    }
    const res = await sendPushToUser(userId, {
      title: "New run (test)",
      body: `${newest.label || "Session"} — tap to log this run.`,
      url: tapUrlForSession(newest.sessionUrl),
      tag: "jrc-new-result",
    });
    return {
      mode: "force",
      speedhiveUrl,
      matched: discovery.candidates.length,
      pushed: res.sent > 0,
      sent: res.sent,
      newestLabel: newest.label ?? null,
      note:
        res.sent > 0
          ? `Forced a test push for your latest session to ${res.sent} device(s).`
          : "No devices to push to — enable notifications on this device first.",
    };
  }

  const r = await checkSpeedhiveResultsForUser({ userId, speedhiveUrl, trackName: null }, now);
  return {
    mode: "check",
    speedhiveUrl,
    matched: r.matched,
    fresh: r.fresh,
    pushed: r.notified,
    sent: r.sent,
    newestLabel: null,
    note: r.notified
      ? `Pushed ${r.fresh} new session(s) to ${r.sent} device(s).`
      : r.matched > 0
        ? "Found your sessions, but none are new + fresh (already notified, already logged, or older than 4h). Use Force to push the latest anyway."
        : r.hint ?? "No sessions matched your transponder / driver name at this URL.",
  };
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
      totalNew += r.fresh;
    } catch (err) {
      console.warn(
        "[result-watch] user check failed",
        JSON.stringify({ userId: target.userId, error: err instanceof Error ? err.message : String(err) }),
      );
    }
  }

  return { targets: targets.length, usersNotified, totalNew };
}
