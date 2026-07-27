/** Archetype masking: field completeness must be correlated and actually stripped. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCHETYPES, applyArchetype, thinSetupData } from "./archetypes";
import type { ScenarioRun } from "./types";

function fullRun(): ScenarioRun {
  return {
    setupData: { camber_front: -1.5, damper_oil_rear: 500, upper_inner_shims_rf: 1.0 },
    lapTimes: [12.4, 12.1, 12.3],
    bestLapSeconds: 12.1,
    avgTop5LapSeconds: 12.27,
    tireRunNumber: 4,
    handlingAssessmentJson: { version: 6, balanceByPhase: { mid: -2 } },
    handlingProblems: "pushing mid",
    notes: "felt ok",
    driverNotes: "traffic on lap 3",
    carRating: 7,
  };
}

test("minimalist strips rating, notes and all handling", () => {
  const r = applyArchetype(fullRun(), ARCHETYPES.minimalist);
  assert.equal(r.carRating, null);
  assert.equal(r.notes, null);
  assert.equal(r.handlingAssessmentJson, undefined);
  assert.equal(r.handlingProblems, null);
  assert.equal(r.tireRunNumber, undefined, "tire age is unreliable for a minimalist");
  assert.deepEqual(r.lapTimes, [12.4, 12.1, 12.3], "laps are imported, so they survive");
});

test("typical keeps the free-text complaint but drops the structured chips", () => {
  const r = applyArchetype(fullRun(), ARCHETYPES.typical);
  assert.equal(r.handlingAssessmentJson, undefined, "chips are the most-skipped field");
  assert.equal(r.handlingProblems, "pushing mid");
  assert.equal(r.carRating, 7);
});

test("completionist keeps everything", () => {
  const r = applyArchetype(fullRun(), ARCHETYPES.completionist);
  assert.ok(r.handlingAssessmentJson);
  assert.equal(r.carRating, 7);
  assert.equal(r.tireRunNumber, 4);
});

test("no-timing removes lap data entirely", () => {
  const r = applyArchetype(fullRun(), ARCHETYPES["no-timing"]);
  assert.deepEqual(r.lapTimes, []);
  assert.equal(r.bestLapSeconds, null);
  assert.equal(r.avgTop5LapSeconds, null);
  assert.equal(r.carRating, 7, "feel is still logged without timing");
});

test("race-weekend sets meeting session fields", () => {
  const r = applyArchetype(fullRun(), ARCHETYPES["race-weekend"]);
  assert.equal(r.sessionType, "RACE_MEETING");
  assert.ok(r.meetingSessionCode);
});

test("partial setup keeps common keys and drops the exotic ones", () => {
  const thin = thinSetupData({ camber_front: -1.5, damper_oil_rear: 500, upper_inner_shims_rf: 1 }, "partial");
  assert.ok("camber_front" in thin);
  assert.ok(!("upper_inner_shims_rf" in thin), "a sparse user has no shim-level detail");
  const full = thinSetupData({ camber_front: -1.5, upper_inner_shims_rf: 1 }, "full");
  assert.ok("upper_inner_shims_rf" in full);
});
