import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RUNS_BASED_ON_IT,
  shapeSavedSetupComboDiff,
  shapeSavedSetupRunOutcomes,
} from "./savedSetupAnchorShape";

const LIBRARY = { front_camber: "2", rear_camber: "1.5", front_spring: "gold" };

function runRow(id: string, snapshotData: unknown) {
  return {
    id,
    whenLabel: "12 Jul 2026",
    sessionLabel: "Q2",
    trackName: "Keilor",
    bestLapSeconds: 14.2,
    carRating: 8,
    snapshotData,
  };
}

test("run outcomes count drift vs the library sheet", () => {
  const out = shapeSavedSetupRunOutcomes(LIBRARY, [
    runRow("same", { ...LIBRARY }),
    runRow("drifted", { ...LIBRARY, front_camber: "2.5", front_spring: "silver" }),
  ]);
  assert.equal(out[0].changedKeyCountVsThisSetup, 0);
  assert.equal(out[1].changedKeyCountVsThisSetup, 2);
});

test("numeric-equal values do not count as drift (2 vs 2.0)", () => {
  const out = shapeSavedSetupRunOutcomes(LIBRARY, [runRow("r", { ...LIBRARY, front_camber: "2.0" })]);
  assert.equal(out[0].changedKeyCountVsThisSetup, 0);
});

test("run outcomes cap at the max", () => {
  const rows = Array.from({ length: MAX_RUNS_BASED_ON_IT + 5 }, (_, i) => runRow(`r${i}`, LIBRARY));
  assert.equal(shapeSavedSetupRunOutcomes(LIBRARY, rows).length, MAX_RUNS_BASED_ON_IT);
});

test("combo diff reads thisSetup vs anchoredRun and never swaps columns", () => {
  const diff = shapeSavedSetupComboDiff(LIBRARY, "run1", {
    front_camber: "1",
    rear_camber: "1.5",
    front_spring: "gold",
  });
  assert.equal(diff.anchoredRunId, "run1");
  assert.equal(diff.changedRowCount, 1);
  const row = diff.changedRows[0];
  assert.equal(row.key, "front_camber");
  assert.equal(row.thisSetup, "2");
  assert.equal(row.anchoredRun, "1");
  assert.equal(diff.truncated, false);
});
