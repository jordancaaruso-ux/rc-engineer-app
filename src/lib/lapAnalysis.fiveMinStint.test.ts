/**
 * Run: `npx tsx --test src/lib/lapAnalysis.fiveMinStint.test.ts`
 *
 * The 5-minute stint — best consecutive five minutes, scored the way a timing loop
 * posts a result (laps, then the clock when the crossing lap completed). One rule for
 * every source and session type: on a real 5-minute race the window has nowhere to
 * slide, so the figure reproduces the posted result by itself.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getBestFiveMinuteStint,
  getDisplayFiveMinuteStint,
  getFiveMinuteStintStartingAt,
  getIncludedLapDashboardMetrics,
  lapRowsFromTimesAndFlags,
  readFiveMinStartLap,
} from "@/lib/lapAnalysis";
import { formatFiveMinuteStint } from "@/lib/runLaps";

const rows = lapRowsFromTimesAndFlags;

test("a 5-minute race self-collapses to the posted result", () => {
  // 16 laps of 19.0 — the clock passes 5:00 during lap 16, which counts on completion.
  // Starting anywhere after lap 1 leaves under five minutes of laps, so the only
  // valid window IS the race.
  const stint = getBestFiveMinuteStint(rows(Array(16).fill(19.0)));
  assert.deepEqual(stint, { lapCount: 16, seconds: 304.0, startLapNumber: 1, endLapNumber: 16 });
});

test("a practice session's window slides past the slow opening", () => {
  // A 30s build-in lap, then twenty at 15.5. From lap 1 the window scores 19 laps;
  // from lap 2 it scores 20. More laps wins.
  const stint = getBestFiveMinuteStint(rows([30, ...Array(20).fill(15.5)]));
  assert.deepEqual(stint, { lapCount: 20, seconds: 310.0, startLapNumber: 2, endLapNumber: 21 });
});

test("equal laps are split by the clock", () => {
  // From lap 1: 20 laps in 301.0. From lap 2: 20 laps in exactly 300.0. Same lap
  // count, less time wins — the LiveRC ranking rule.
  const stint = getBestFiveMinuteStint(rows([16, ...Array(20).fill(15.0)]));
  assert.deepEqual(stint, { lapCount: 20, seconds: 300.0, startLapNumber: 2, endLapNumber: 21 });
});

test("the crossing lap counts in full — never a figure at exactly 5:00 unless laps land there", () => {
  // 15 laps of 21.0: 14 laps = 294, the 15th crosses 5:00 and counts whole.
  const stint = getBestFiveMinuteStint(rows(Array(15).fill(21.0)));
  assert.deepEqual(stint, { lapCount: 15, seconds: 315.0, startLapNumber: 1, endLapNumber: 15 });
});

test("a session without five minutes of laps has no figure", () => {
  assert.equal(getBestFiveMinuteStint(rows(Array(10).fill(20.0))), null);
});

test("lap 0 is dropped and cannot rescue a short session", () => {
  // 18 real laps of 16.0 = 288s — under five minutes even though a 120s out-lap
  // (lap #0) would push the wall clock over.
  const withOutLap = [
    { lapNumber: 0, lapTimeSeconds: 120, isIncluded: true },
    ...rows(Array(18).fill(16.0)),
  ];
  assert.equal(getBestFiveMinuteStint(withOutLap), null);
});

test("excluded laps still cost wall-clock time — the stint ignores the flag", () => {
  // Ten laps of 16, a 40s crash lap (excluded), ten more of 16. Every five-minute
  // window spans the crash, and it counts: a stint is wall clock.
  const times = [...Array(10).fill(16.0), 40.0, ...Array(10).fill(16.0)];
  const flags = times.map((_, i) => (i === 10 ? { isIncluded: false } : null));
  const excluded = getBestFiveMinuteStint(rows(times, flags));
  const included = getBestFiveMinuteStint(rows(times));
  assert.deepEqual(excluded, { lapCount: 18, seconds: 312.0, startLapNumber: 1, endLapNumber: 18 });
  assert.deepEqual(excluded, included);
});

test("the dashboard metrics carry the same stint the raw rows produce", () => {
  const laps = rows([30, ...Array(20).fill(15.5)]);
  const dash = getIncludedLapDashboardMetrics(laps);
  assert.deepEqual(dash.fiveMinStint, getBestFiveMinuteStint(laps));
});

test("a hand-placed window opens on the chosen lap; the clock still does the rest", () => {
  const laps = rows([30, ...Array(20).fill(15.5)]);
  assert.deepEqual(getFiveMinuteStintStartingAt(laps, 1), {
    lapCount: 19,
    seconds: 309.0,
    startLapNumber: 1,
    endLapNumber: 19,
  });
  // From lap 3 only 294.5s of laps remain — no window, never a padded figure.
  assert.equal(getFiveMinuteStintStartingAt(laps, 3), null);
  // A lap that doesn't exist is not a handle.
  assert.equal(getFiveMinuteStintStartingAt(laps, 99), null);
});

test("the displayed stint is the choice when valid, the best when not", () => {
  const laps = rows([30, ...Array(20).fill(15.5)]);
  assert.equal(getDisplayFiveMinuteStint(laps, 1)?.startLapNumber, 1);
  // Stale choice (laps re-imported shorter, say) → auto, silently.
  assert.equal(getDisplayFiveMinuteStint(laps, 3)?.startLapNumber, 2);
  assert.equal(getDisplayFiveMinuteStint(laps, null)?.startLapNumber, 2);
});

test("the stored choice reads only off a well-formed version-1 blob", () => {
  assert.equal(readFiveMinStartLap({ version: 1, fiveMinStartLap: 4 }), 4);
  assert.equal(readFiveMinStartLap({ version: 1 }), null);
  assert.equal(readFiveMinStartLap({ version: 2, fiveMinStartLap: 4 }), null);
  assert.equal(readFiveMinStartLap({ version: 1, fiveMinStartLap: 2.5 }), null);
  assert.equal(readFiveMinStartLap({ version: 1, fiveMinStartLap: 0 }), null);
  assert.equal(readFiveMinStartLap(null), null);
});

test("formats laps-first the way LiveRC posts it", () => {
  assert.equal(formatFiveMinuteStint({ lapCount: 13, seconds: 312.345 }), "13/5:12.345");
  assert.equal(formatFiveMinuteStint({ lapCount: 13, seconds: 312.345 }, 1), "13/5:12.3");
  assert.equal(formatFiveMinuteStint({ lapCount: 13, seconds: 312.345 }, 0), "13/5:12");
  assert.equal(formatFiveMinuteStint({ lapCount: 13, seconds: 359.6 }, 0), "13/6:00");
  // Rounding must carry, never print ":60".
  assert.equal(formatFiveMinuteStint({ lapCount: 13, seconds: 359.97 }, 1), "13/6:00.0");
  assert.equal(formatFiveMinuteStint({ lapCount: 14, seconds: 300.0 }), "14/5:00.000");
});
