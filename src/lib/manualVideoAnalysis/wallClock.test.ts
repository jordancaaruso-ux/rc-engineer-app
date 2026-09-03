/**
 * The clock arithmetic, on the real numbers from IMG_4521 (Bendigo practice, 2026-08-30).
 */
import { CLOCK_DISAGREE_SEC, isPracticeTiming, predictedCrossingSec, predictedLapOneSec } from "./wallClock";
import type { ManualDriver, ManualTimingSession } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const RECORDED = "2026-08-30T05:37:36.000Z";
const laps = (times: number[]): ManualDriver["laps"] =>
  times.map((lapTimeSec, i) => ({ lapNumber: i + 1, lapTimeSec, isIncluded: true }));
const driver = (times: number[]): ManualDriver => ({
  key: "k",
  driverName: "Cooper Webster",
  normalizedName: "cooper webster",
  role: "r3",
  laps: laps(times),
});
const session = (stamp: string | null, d: ManualDriver): ManualTimingSession => ({
  sessionId: "ts",
  label: "practice",
  sessionCompletedAtIso: stamp,
  isOnVideo: true,
  drivers: [d],
  sync: {},
});

/* ---------- the four drivers of IMG_4521 ---------- */
{
  const cooper = driver([15.701, 15.619, 15.458, 15.516, 44.462]);
  const at = predictedLapOneSec(session("2026-08-30T05:38:26.000Z", cooper), cooper, RECORDED, 1747.3);
  assert(at != null && Math.abs(at - 50) < 1e-9, `Cooper's lap 1 at 50s, got ${at}`);
  const justin = driver([15.848, 15.573, 15.491]);
  const j = predictedLapOneSec(session("2026-08-30T05:50:14.000Z", justin), justin, RECORDED, 1747.3);
  assert(j != null && Math.abs(j - 758) < 1e-9, `Justin's lap 1 at 758s, got ${j}`);
  // Tapped by hand at 758.42 — within the tolerance, no line on screen.
  assert(Math.abs(758.42 - j!) < CLOCK_DISAGREE_SEC, "a tap half a second off agrees");
  // Cooper's hand tap at 14.73 is the case this exists for.
  assert(Math.abs(14.73 - at!) > CLOCK_DISAGREE_SEC, "a tap 35s off disagrees");
}

/* ---------- walking to a later crossing ---------- */
{
  const d = driver([15.701, 15.619, 15.458]);
  const start3 = predictedCrossingSec(50, d, 3, "sf_start");
  assert(start3 != null && Math.abs(start3 - (50 + 15.701 + 15.619)) < 1e-9, "lap 3 starts after laps 1 and 2");
  const end3 = predictedCrossingSec(50, d, 3, "sf_finish");
  assert(end3 != null && Math.abs(end3 - (50 + 15.701 + 15.619 + 15.458)) < 1e-9, "lap 3 ends a lap later");
  assert(predictedCrossingSec(50, d, 9, "sf_start") == null, "a lap the driver never ran has no crossing");
}

/* ---------- when the clock says nothing ---------- */
{
  const d = driver([15.7, 15.6, 15.5, 15.4]);
  assert(predictedLapOneSec(session(null, d), d, RECORDED) == null, "no page stamp, no prediction");
  assert(predictedLapOneSec(session("2026-08-30T05:38:26.000Z", d), d, null) == null, "no recording stamp, no prediction");
  assert(predictedLapOneSec(session("2026-08-30T05:30:00.000Z", d), d, RECORDED) == null, "a session that began before the camera is not on it");
  assert(predictedLapOneSec(session("2026-08-30T06:30:00.000Z", d), d, RECORDED, 1747) == null, "a session after the camera stopped is not on it");
  // A second early is the page rounding, not a different session.
  const early = predictedLapOneSec(session("2026-08-30T05:37:35.000Z", d), d, RECORDED);
  assert(early != null && early === -1, "just before the file starts is still offered");
}

/* ---------- a race is not a practice ---------- */
{
  // A race's lap 1 is the tone-to-line fragment; realLaps drops it, so the clock stays quiet.
  const race = driver([1.386, 17.9, 17.4, 17.6, 18.2]);
  assert(!isPracticeTiming(race), "the opening fragment marks a race");
  assert(predictedLapOneSec(session("2026-08-30T05:38:26.000Z", race), race, RECORDED) == null, "no prediction for a race");
  assert(isPracticeTiming(driver([15.7, 15.6, 15.5])), "whole laps from the first crossing mark a practice");
}

console.log("wallClock: ok");
