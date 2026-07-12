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

/**
 * Users to poll now, from two arming signals (a formal Event is no longer required —
 * that missed casual test days):
 *   A) participants in a Speedhive-enabled event active today, and
 *   B) anyone who has logged a run today at a Speedhive-enabled track.
 * (B) covers eventless practice/race days: once the driver logs their first run, the
 * watcher picks up their remaining sessions for the rest of the day. Deduped per
 * (user, Speedhive URL).
 */
export async function getResultWatchTargets(now: Date): Promise<ResultWatchTarget[]> {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const [events, runsToday] = await Promise.all([
    prisma.event.findMany({
      where: {
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
        track: { speedhiveUrl: { not: null } },
      },
      select: {
        track: { select: { name: true, speedhiveUrl: true } },
        participations: { select: { userId: true } },
      },
    }),
    prisma.run.findMany({
      where: {
        sortAt: { gte: dayStart, lte: dayEnd },
        track: { speedhiveUrl: { not: null } },
      },
      select: {
        userId: true,
        track: { select: { name: true, speedhiveUrl: true } },
      },
      distinct: ["userId", "trackId"],
    }),
  ]);

  const byKey = new Map<string, ResultWatchTarget>();
  const add = (userId: string, url: string | null | undefined, trackName: string | null) => {
    const u = url?.trim();
    if (!u) return;
    const key = `${userId}::${u}`;
    if (!byKey.has(key)) byKey.set(key, { userId, speedhiveUrl: u, trackName });
  };

  for (const ev of events) {
    for (const p of ev.participations) {
      add(p.userId, ev.track?.speedhiveUrl, ev.track?.name ?? null);
    }
  }
  for (const r of runsToday) {
    add(r.userId, r.track?.speedhiveUrl, r.track?.name ?? null);
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
  /** Newest matched session (whether or not it's fresh) — for transparent test reporting. */
  newestLabel: string | null;
  newestIso: string | null;
};

/**
 * Deep-link for a "new run" notification. The notification is a pure trigger: it opens
 * the normal Add Run flow and resumes today's in-progress draft if one exists (so pre-run
 * setup/notes aren't orphaned). It NEVER auto-imports laps — the driver adds laps the
 * normal way. Hence a constant, session-less link.
 */
const NEW_RUN_TAP_URL = "/runs/new?resume=1";

export async function checkSpeedhiveResultsForUser(
  target: ResultWatchTarget,
  now: Date,
): Promise<ResultCheckReport> {
  if (!(await hasSpeedhiveIdentityForUser(target.userId))) {
    return {
      matched: 0,
      fresh: 0,
      notified: false,
      sent: 0,
      hint: "No Speedhive transponder / driver name set.",
      newestLabel: null,
      newestIso: null,
    };
  }

  const discovery = await discoverSpeedhiveSessionsForUser({
    userId: target.userId,
    trackSpeedhiveUrl: target.speedhiveUrl,
  });

  const newestMatch = discovery.candidates[0] ?? null;
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
      newestLabel: newestMatch?.label ?? null,
      newestIso: newestMatch?.sessionCompletedAtIso ?? null,
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
    url: NEW_RUN_TAP_URL,
    tag: "jrc-new-result",
  });

  return {
    matched: discovery.candidates.length,
    fresh: fresh.length,
    notified: res.sent > 0,
    sent: res.sent,
    hint: null,
    newestLabel: newestMatch?.label ?? null,
    newestIso: newestMatch?.sessionCompletedAtIso ?? null,
  };
}

export type WatchTestReport = {
  mode: "check" | "test";
  speedhiveUrl: string;
  matched: number;
  fresh?: number;
  pushed: boolean;
  sent: number;
  newestLabel: string | null;
  note: string;
};

/** Human date + age for the newest matched session, so "nothing fresh" is self-explanatory. */
function describeNewest(label: string | null, iso: string | null, now: Date): string {
  if (!label && !iso) return "none";
  const parts: string[] = [];
  if (label) parts.push(label);
  if (iso) {
    const t = new Date(iso).getTime();
    if (!Number.isNaN(t)) {
      const days = Math.floor((now.getTime() - t) / 86_400_000);
      const date = iso.slice(0, 10);
      parts.push(days >= 1 ? `${date} (${days} day${days === 1 ? "" : "s"} ago)` : date);
    }
  }
  return parts.join(" — ");
}

/**
 * On-demand test tool (Settings → Notifications).
 * - `force` (= "Send test push") sends a CANNED notification to prove the push → tap → Add Run
 *   plumbing. It does NOT look up real sessions, so it can never surface a stale old run.
 * - otherwise ("Check now") runs the real watcher logic (dedup + 4h freshness, persists) and
 *   reports transparently — including the newest matched session's date and the URL used — so
 *   a "nothing fresh" result explains itself.
 */
export async function runWatchTest(
  input: { userId: string; speedhiveUrl: string; force: boolean },
  now: Date,
): Promise<WatchTestReport> {
  const { userId, speedhiveUrl, force } = input;

  if (force) {
    const res = await sendPushToUser(userId, {
      title: "Test notification",
      body: "This is a test — tap to open Add Run.",
      url: NEW_RUN_TAP_URL,
      tag: "jrc-new-result",
    });
    return {
      mode: "test",
      speedhiveUrl,
      matched: 0,
      pushed: res.sent > 0,
      sent: res.sent,
      newestLabel: null,
      note:
        res.sent > 0
          ? `Sent a canned test notification to ${res.sent} device(s) — tap it to check the Add Run flow. It does not look up real sessions.`
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
    newestLabel: r.newestLabel,
    note: r.notified
      ? `Pushed ${r.fresh} new session(s) to ${r.sent} device(s).`
      : r.matched > 0
        ? `Found ${r.matched} matching session(s) at ${speedhiveUrl}, but none are new + recent (<4h) — so the real watcher would NOT notify. Newest match: ${describeNewest(r.newestLabel, r.newestIso, now)}.`
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
