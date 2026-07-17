/**
 * Run: `npx tsx src/lib/runPickerFormat.test.ts`
 *
 * Picker lines must honor per-lap exclusions — a lap flagged `isIncluded: false`
 * in `lapSession.entries[0].perLap` must never surface as the best lap.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRunPickerLine, type RunPickerRun } from "@/lib/runPickerFormat";
import { withIncludedBestLapForPicker } from "@/lib/lapAnalysis";

function pickerRun(overrides: Partial<RunPickerRun>): RunPickerRun {
  return {
    id: "r1",
    createdAt: new Date("2026-07-01T10:00:00Z"),
    sessionType: "TESTING",
    sessionLabel: "Run 1",
    track: { name: "Track A" },
    car: { name: "Car A" },
    ...overrides,
  };
}

/** lapSession blob with the given per-lap inclusion flags for the primary entry. */
function lapSessionWithFlags(laps: number[], included: boolean[]): unknown {
  return {
    version: 1,
    source: { kind: "manual" },
    entries: [
      {
        role: "primary",
        laps,
        perLap: included.map((ok) => ({ isIncluded: ok })),
      },
    ],
  };
}

test("picker line best lap skips excluded laps when lapSession is present", () => {
  const line = formatRunPickerLine(
    pickerRun({
      lapTimes: [14.2, 22.9, 14.5],
      lapSession: lapSessionWithFlags([14.2, 22.9, 14.5], [false, true, true]),
    })
  );
  // 14.2 is excluded — best included lap is 14.5.
  assert.ok(line.endsWith("— 14.500"), line);
});

test("picker line trusts the API's exclusion-aware bestLapSeconds when lapSession is absent", () => {
  const line = formatRunPickerLine(
    pickerRun({ lapTimes: [14.2, 14.5], bestLapSeconds: 14.5 })
  );
  assert.ok(line.endsWith("— 14.500"), line);
});

test("picker line shows no lap when every lap is excluded", () => {
  const line = formatRunPickerLine(
    pickerRun({
      lapTimes: [14.2, 14.5],
      lapSession: lapSessionWithFlags([14.2, 14.5], [false, false]),
    })
  );
  assert.ok(!line.includes("14."), line);
});

test("picker line falls back to raw laps for legacy shapes with neither field", () => {
  const line = formatRunPickerLine(pickerRun({ lapTimes: [15.1, 14.9] }));
  assert.ok(line.endsWith("— 14.900"), line);
});

test("withIncludedBestLapForPicker computes included best when the stored column is null and strips lapSession", () => {
  const out = withIncludedBestLapForPicker({
    lapTimes: [14.2, 22.9, 14.5],
    lapSession: lapSessionWithFlags([14.2, 22.9, 14.5], [false, true, true]),
    bestLapSeconds: null,
  });
  assert.equal(out.bestLapSeconds, 14.5);
  assert.ok(!("lapSession" in out));
});

test("withIncludedBestLapForPicker prefers the stored exclusion-aware column when set", () => {
  const out = withIncludedBestLapForPicker({
    lapTimes: [14.2, 14.5],
    lapSession: null,
    bestLapSeconds: 14.5,
  });
  assert.equal(out.bestLapSeconds, 14.5);
});
