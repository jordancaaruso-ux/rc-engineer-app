import assert from "node:assert/strict";
import test from "node:test";
import { WIZARD_STEPS, firstUnfinishedStep, nextWalkStep, walkStepIds } from "./wizardWalk";

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

test("draft resume lands on the first unfinished step", () => {
  // Typical pre-run draft: everything before the seam saved, laps + rating open.
  assert.equal(
    firstUnfinishedStep({ session: true, equipment: true, prep: true, setup: true }),
    "laps"
  );
  // Laps imported, rating still missing → Feedback.
  assert.equal(
    firstUnfinishedStep({
      session: true,
      equipment: true,
      prep: true,
      setup: true,
      laps: true,
    }),
    "feel"
  );
  // Trackless draft: Session itself is unfinished.
  assert.equal(firstUnfinishedStep({ equipment: true, setup: true }), "session");
});

test("a fully-logged run (editing a completed one) lands back on Session", () => {
  assert.equal(
    firstUnfinishedStep({
      session: true,
      equipment: true,
      prep: true,
      setup: true,
      laps: true,
      feel: true,
    }),
    "session"
  );
});
