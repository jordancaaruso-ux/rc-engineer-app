import assert from "node:assert/strict";
import test from "node:test";
import {
  crossesSeam,
  nextWalkStep,
  prevWalkStep,
  walkStepIds,
} from "./wizardWalk";

test("fresh log walks all five steps in order (laps before feel)", () => {
  assert.deepEqual(walkStepIds(false, new Set()), [
    "equipment",
    "prep",
    "setup",
    "laps",
    "feel",
  ]);
});

test("continuing with nothing flagged walks only the after-run set", () => {
  assert.deepEqual(walkStepIds(true, new Set()), ["laps", "feel"]);
});

test("tires and battery chips both map to the Equipment step (no dupes)", () => {
  assert.deepEqual(walkStepIds(true, new Set(["tires", "battery"])), [
    "equipment",
    "laps",
    "feel",
  ]);
});

test("setup + prep chips join in global order", () => {
  assert.deepEqual(walkStepIds(true, new Set(["setup", "prep"])), [
    "prep",
    "setup",
    "laps",
    "feel",
  ]);
});

test("unknown chip ids are ignored", () => {
  assert.deepEqual(walkStepIds(true, new Set(["track"])), ["laps", "feel"]);
});

test("nextWalkStep advances along the walk and returns null at the end", () => {
  const walk = walkStepIds(true, new Set(["setup"]));
  assert.equal(nextWalkStep("setup", walk), "laps");
  assert.equal(nextWalkStep("feel", walk), null);
});

test("nextWalkStep from a carried (off-walk) step resumes the walk", () => {
  const walk = walkStepIds(true, new Set()); // laps → feel
  assert.equal(nextWalkStep("prep", walk), "laps");
});

test("prevWalkStep steps back and returns null at the start", () => {
  const walk = walkStepIds(true, new Set(["prep"]));
  assert.equal(prevWalkStep("laps", walk), "prep");
  assert.equal(prevWalkStep("prep", walk), null);
});

test("crossesSeam fires only on the pre-run → after-run boundary", () => {
  assert.equal(crossesSeam("setup", "laps"), true);
  assert.equal(crossesSeam("equipment", "laps"), true); // nothing else flagged
  assert.equal(crossesSeam("equipment", "prep"), false);
  assert.equal(crossesSeam("laps", "feel"), false);
});
