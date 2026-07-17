import assert from "node:assert/strict";
import test from "node:test";
import { WIZARD_STEPS, nextWalkStep, walkStepIds } from "./wizardWalk";

test("every run walks all six steps in order (session first, laps before feel)", () => {
  assert.deepEqual(walkStepIds(), [
    "session",
    "equipment",
    "prep",
    "setup",
    "laps",
    "feel",
  ]);
});

test("nextWalkStep advances along the walk and returns null at the end", () => {
  const walk = walkStepIds();
  assert.equal(nextWalkStep("session", walk), "equipment");
  assert.equal(nextWalkStep("setup", walk), "laps");
  assert.equal(nextWalkStep("feel", walk), null);
});

test("the pre-run boundary (bar divider) sits between setup and laps", () => {
  const preRun = WIZARD_STEPS.filter((s) => s.preRun).map((s) => s.id);
  assert.deepEqual(preRun, ["session", "equipment", "prep", "setup"]);
});
