/**
 * Run: `npx tsx src/lib/runPickerFormat.test.ts`
 *
 * Picker lines must honor per-lap exclusions — a lap flagged `isIncluded: false`
 * in `lapSession.entries[0].perLap` must never surface as the best lap.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatRunPickerLine,
  formatRunPickerParts,
  type RunPickerRun,
} from "@/lib/runPickerFormat";
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

/* ── Two-line parts (Geometry Lab picker) ── */

test("parts split a testing run into which-session and which-car", () => {
  const parts = formatRunPickerParts(
    pickerRun({ sessionLabel: "Run 3", bestLapSeconds: 14.921 })
  );
  assert.equal(parts.title, "Testing · Run 3");
  assert.equal(parts.detail, "Track A · Car A · 14.921");
  // The date lives in `when` only — repeating it in the title wrapped every row.
  assert.match(parts.when, /2026|ago|Today|Yesterday/, parts.when);
});

test("parts lead with the event name for a meeting run", () => {
  const parts = formatRunPickerParts(
    pickerRun({
      sessionType: "RACE_MEETING",
      sessionLabel: null,
      meetingSessionType: "QUALIFIER",
      meetingSessionCode: "Q2",
      eventId: "e1",
      event: { name: "Winter Series Rd 3" },
    })
  );
  assert.ok(parts.title.startsWith("Winter Series Rd 3 · "), parts.title);
  assert.ok(!parts.title.includes("Testing"), parts.title);
});

test("parts keep the date out of the title so it isn't printed twice", () => {
  const parts = formatRunPickerParts(pickerRun({ sessionLabel: null }));
  assert.equal(parts.title, "Testing");
  assert.ok(!/2026/.test(parts.title), parts.title);
});

test("parts drop missing track and car instead of showing placeholders", () => {
  const parts = formatRunPickerParts(
    pickerRun({ track: null, car: null, bestLapSeconds: 14.5 })
  );
  assert.equal(parts.detail, "14.500");
  assert.ok(!parts.detail.includes("—"), parts.detail);
});

test("parts leave detail empty when nothing about the car is known", () => {
  const parts = formatRunPickerParts(pickerRun({ track: null, car: null }));
  assert.equal(parts.detail, "");
});

test("parts honor per-lap exclusions in the detail line", () => {
  const parts = formatRunPickerParts(
    pickerRun({
      lapTimes: [14.2, 22.9, 14.5],
      lapSession: lapSessionWithFlags([14.2, 22.9, 14.5], [false, true, true]),
    })
  );
  assert.equal(parts.detail, "Track A · Car A · 14.500");
});

test("parts prefix the driver name for a teammate run", () => {
  const parts = formatRunPickerParts(
    { ...pickerRun({ sessionLabel: "Run 3" }), userId: "u2" },
    { u2: "Ben Carter" }
  );
  assert.ok(parts.title.startsWith("Ben Carter · Testing"), parts.title);
});

test("parts skip the driver prefix when the display map has no entry", () => {
  const parts = formatRunPickerParts(
    { ...pickerRun({ sessionLabel: "Run 3" }), userId: "u2" },
    { u9: "Someone Else" }
  );
  assert.ok(parts.title.startsWith("Testing "), parts.title);
  assert.ok(parts.title.endsWith(" · Run 3"), parts.title);
});
