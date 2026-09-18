import test from "node:test";
import assert from "node:assert/strict";
import { planSameOutingAbsorption, runHasDriverWriting } from "@/lib/runs/sameOutingAbsorption";

const at = (hhmmss: string) => new Date(`2026-08-23T${hhmmss}.000Z`);
/** The driver's run: the MyRCM qualifier, 00:36:37–00:47:08 UTC (10:36 at a Sydney track). */
const RUN = [{ start: at("00:36:37"), end: at("00:47:08") }];

test("the app's Speedhive run over the same heat folds in; the next heat does not", () => {
  const plan = planSameOutingAbsorption(RUN, [
    { id: "speedhive-copy", spans: [{ start: at("00:36:40"), end: at("00:47:11") }], writtenOn: false },
    // The next qualifier, starting a minute after this one ended: touches nothing worth the name.
    { id: "next-heat", spans: [{ start: at("00:46:50"), end: at("00:57:20") }], writtenOn: false },
    { id: "afternoon", spans: [{ start: at("03:10:00"), end: at("03:18:00") }], writtenOn: false },
  ]);
  assert.deepEqual(plan, ["speedhive-copy"]);
});

test("a run the driver wrote on stays, even over the same heat", () => {
  const plan = planSameOutingAbsorption(RUN, [
    { id: "noted", spans: [{ start: at("00:36:40"), end: at("00:47:11") }], writtenOn: true },
  ]);
  assert.deepEqual(plan, []);
});

test("a run with no measurable time on track takes nothing in", () => {
  assert.deepEqual(
    planSameOutingAbsorption([], [{ id: "x", spans: RUN, writtenOn: false }]),
    []
  );
  assert.deepEqual(
    planSameOutingAbsorption(RUN, [{ id: "no-sessions", spans: [], writtenOn: false }]),
    []
  );
});

test("writing is notes, a rating or handling — not blanks", () => {
  assert.equal(runHasDriverWriting({}), false);
  assert.equal(runHasDriverWriting({ notes: "   ", carRating: null, handlingAssessmentJson: null }), false);
  assert.equal(runHasDriverWriting({ notes: "pushed on entry" }), true);
  assert.equal(runHasDriverWriting({ carRating: 7 }), true);
  assert.equal(runHasDriverWriting({ handlingAssessmentJson: { v: 1 } }), true);
});
