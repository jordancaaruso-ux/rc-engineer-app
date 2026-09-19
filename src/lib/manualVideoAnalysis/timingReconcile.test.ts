/**
 * Reloading the timing must not strand the work that hangs off it.
 *
 * From the Bendigo job of 2026-09-01: re-importing the timing minted a new session id, so 86
 * marks and the sync anchor were left keyed to sessions that no longer existed. Nothing was
 * deleted and nothing was shown — the mark step simply fell back to splitting the lap into equal
 * pieces, and S1's dot landed on the start/finish line with the car still in the last corner.
 */
import { reconcileTimingSessions, sameTimingSession } from "./timing";
import type { ManualDriver, ManualTimingSession } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const lapsOf = (times: number[]): ManualDriver["laps"] =>
  times.map((lapTimeSec, i) => ({ lapNumber: i + 1, lapTimeSec, isIncluded: true }));

function sessionOf(
  sessionId: string,
  times: number[],
  opts: { url?: string; anchorSec?: number } = {}
): ManualTimingSession {
  return {
    sessionId,
    label: "practice",
    sourceUrl: opts.url ?? "https://borrccc.liverc.com/practice/?p=view_session&id=24468914",
    isOnVideo: true,
    drivers: [
      {
        key: `${sessionId}::d1`,
        driverName: "Jordan Caruso",
        normalizedName: "jordan caruso",
        role: "me",
        laps: lapsOf(times),
      },
    ],
    sync:
      opts.anchorSec != null
        ? { anchor: { lapNumber: 1, anchorKind: "sf_start", driverRole: "me", videoTimeSec: opts.anchorSec } }
        : {},
  };
}

const TIMES = [15.52, 15.598, 15.162, 15.009, 14.942];

/* ---------- the same timing, loaded again ---------- */
{
  const before = sessionOf("ts_old", TIMES, { anchorSec: 8.583 });
  const loaded = sessionOf("ts_fresh", TIMES);
  assert(sameTimingSession(before, loaded), "same url and same laps is the same session");

  const { sessions, replacedSessionIds } = reconcileTimingSessions([before], [loaded]);
  assert(sessions[0]!.sessionId === "ts_old", `id must be kept, got ${sessions[0]!.sessionId}`);
  assert(sessions[0]!.sync.anchor?.videoTimeSec === 8.583, "the sync anchor must survive a reload");
  assert(replacedSessionIds.length === 0, "nothing was replaced");
  assert(
    sessions[0]!.drivers[0]!.key === "ts_old::d1",
    `driver keys are namespaced by session id: ${sessions[0]!.drivers[0]!.key}`
  );
}

/* ---------- the same session with more laps recorded since ---------- */
{
  const before = sessionOf("ts_old", TIMES, { anchorSec: 8.583 });
  const loaded = sessionOf("ts_fresh", [...TIMES, 15.11, 15.25]);
  const { sessions } = reconcileTimingSessions([before], [loaded]);
  assert(sessions[0]!.sessionId === "ts_old", "extra laps are still the same session");
  assert(sessions[0]!.drivers[0]!.laps.length === 7, "the laps themselves come fresh from the timing");
}

/* ---------- genuinely different timing keeps its own identity ---------- */
{
  const before = sessionOf("ts_old", TIMES, { anchorSec: 8.583 });
  // Same URL, a different run: the lap times do not line up.
  const loaded = sessionOf("ts_fresh", [16.757, 15.079, 14.843, 15.717, 15.067]);
  assert(!sameTimingSession(before, loaded), "different lap times are a different session");
  const { sessions, replacedSessionIds } = reconcileTimingSessions([before], [loaded]);
  assert(sessions[0]!.sessionId === "ts_fresh", "a different session gets its own id");
  assert(
    replacedSessionIds.length === 1 && replacedSessionIds[0] === "ts_old",
    "the caller must be told which session's marks are now stale"
  );
}

/* ---------- a different source is never adopted ---------- */
{
  const before = sessionOf("ts_old", TIMES, { url: "https://a.example/1", anchorSec: 1 });
  const loaded = sessionOf("ts_fresh", TIMES, { url: "https://b.example/2" });
  assert(!sameTimingSession(before, loaded), "same laps at a different URL is not the same session");
}

/* ---------- one lap in common proves nothing ---------- */
{
  const before = sessionOf("ts_old", [15.1], { anchorSec: 1 });
  const loaded = sessionOf("ts_fresh", [15.1, 15.4, 15.2]);
  assert(!sameTimingSession(before, loaded), "a single matching lap is a coincidence, not an identity");
}

console.log("manualVideoAnalysis timingReconcile.test.ts OK");
