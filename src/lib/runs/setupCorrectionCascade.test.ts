import test from "node:test";
import assert from "node:assert/strict";

import {
  correctionHasSomethingToOffer,
  planSetupCorrection,
  type LaterRunForCorrection,
} from "@/lib/runs/setupCorrectionCascade";

const KEY = "ride_height_rear";

function plan(runs: LaterRunForCorrection[], previousValue: unknown = "5.0", nextValue: unknown = "5.5") {
  return planSetupCorrection({ key: KEY, previousValue, nextValue, runs });
}

test("no later runs means nothing to offer", () => {
  const candidates = plan([]);
  assert.deepEqual(candidates, []);
  assert.equal(correctionHasSomethingToOffer(candidates), false);
});

test("runs that inherited the old value are ticked", () => {
  const candidates = plan([
    { id: "r4", value: "5.0" },
    { id: "r5", value: "5.0" },
  ]);
  assert.deepEqual(
    candidates.map((c) => [c.runId, c.defaultPicked]),
    [
      ["r4", true],
      ["r5", true],
    ]
  );
  assert.equal(correctionHasSomethingToOffer(candidates), true);
});

test("the walk stops at the first run holding something else, and never resumes", () => {
  // r6 is a deliberate change. r7 holds the old value again, but it descends from
  // r6 — reaching it would jump the change the driver actually made.
  const candidates = plan([
    { id: "r4", value: "5.0" },
    { id: "r5", value: "5.0" },
    { id: "r6", value: "6.0" },
    { id: "r7", value: "5.0" },
  ]);
  assert.deepEqual(
    candidates.map((c) => [c.runId, c.defaultPicked]),
    [
      ["r4", true],
      ["r5", true],
      ["r6", false],
      ["r7", false],
    ]
  );
  // Every later run is still listed, so the driver can tick r7 by hand.
  assert.equal(candidates.length, 4);
});

test("a run already carrying the corrected value is flagged and left unticked", () => {
  const candidates = plan([
    { id: "r4", value: "5.5" },
    { id: "r5", value: "5.0" },
  ]);
  assert.equal(candidates[0].alreadyCorrect, true);
  // Ticking it would write nothing, so it starts unticked.
  assert.equal(candidates[0].defaultPicked, false);
  // …but it does not end the walk: a run already holding the corrected value is
  // usually one the driver fixed by hand, which argues FOR carrying on.
  assert.equal(candidates[1].defaultPicked, true);
});

test("numeric and string spellings of the same value are one value", () => {
  const candidates = planSetupCorrection({
    key: KEY,
    previousValue: 5,
    nextValue: 5.5,
    runs: [{ id: "r4", value: "5.0" }, { id: "r5", value: "5" }],
  });
  assert.deepEqual(
    candidates.map((c) => c.holdsOldValue),
    [true, true]
  );
});

test("a blank value on a later run is not the old value", () => {
  const candidates = plan([
    { id: "r4", value: null },
    { id: "r5", value: "5.0" },
  ]);
  assert.equal(candidates[0].holdsOldValue, false);
  assert.equal(candidates[0].defaultPicked, false);
  // …and the walk stopped there, so r5 is listed but not ticked.
  assert.equal(candidates[1].defaultPicked, false);
});

test("filling in a value that was blank carries forward to the runs still blank", () => {
  const candidates = plan(
    [
      { id: "r4", value: null },
      { id: "r5", value: "" },
      { id: "r6", value: "4.0" },
    ],
    null,
    "5.5"
  );
  assert.deepEqual(
    candidates.map((c) => c.defaultPicked),
    [true, true, false]
  );
});

test("displayValue is the run's own value, normalized the way the diff table shows it", () => {
  const candidates = plan([{ id: "r4", value: "5.0" }, { id: "r5", value: null }]);
  // `5.0` and `5` are one value everywhere in the app; the picker must not be the
  // one surface that spells it differently.
  assert.equal(candidates[0].displayValue, "5");
  assert.equal(candidates[1].displayValue, "—");
});

// ── the backward walk (2026-08-21) ───────────────────────────────────────────

test("the stopping run is marked, and only that one", () => {
  const candidates = plan([
    { id: "r4", value: "5.0" },
    { id: "r5", value: "6.0" },
    { id: "r6", value: "7.0" },
  ]);
  assert.deepEqual(
    candidates.map((c) => c.stopsWalk),
    // r5 ends the walk. r6 is past it, not the thing that ended it — otherwise the
    // sheet would print "typed on purpose" against every row after a change.
    [false, true, false]
  );
});

test("tickReached: false reaches the same runs but ticks none of them", () => {
  const runs = [
    { id: "r3", value: "5.0" },
    { id: "r2", value: "5.0" },
    { id: "r1", value: "9.0" },
  ];
  const backward = planSetupCorrection({
    key: KEY,
    previousValue: "5.0",
    nextValue: "5.5",
    runs,
    tickReached: false,
  });
  assert.deepEqual(
    backward.map((c) => c.defaultPicked),
    [false, false, false]
  );
  // The walk itself is unchanged — r1 still ends it, which is what the caller
  // truncates the earlier list at.
  assert.deepEqual(
    backward.map((c) => c.stopsWalk),
    [false, false, true]
  );
  // …and the same runs, ticked, is exactly what the forward walk produces.
  assert.deepEqual(
    planSetupCorrection({ key: KEY, previousValue: "5.0", nextValue: "5.5", runs }).map(
      (c) => c.defaultPicked
    ),
    [true, true, false]
  );
});

test("an unticked backward-only correction is still worth asking about", () => {
  /*
   * The regression this guards: `correctionHasSomethingToOffer` used to require a
   * `defaultPicked`, and no earlier run ever has one. Correcting the NEWEST run on a
   * car — nothing after it, everything before it holding the old value — would have
   * been planned in full and then silently thrown away, which is the exact case the
   * backward walk was built for.
   */
  const backward = planSetupCorrection({
    key: KEY,
    previousValue: "5.0",
    nextValue: "5.5",
    runs: [{ id: "r2", value: "5.0" }, { id: "r1", value: "5.0" }],
    tickReached: false,
  });
  assert.equal(
    backward.every((c) => !c.defaultPicked),
    true
  );
  assert.equal(correctionHasSomethingToOffer(backward), true);
});

test("nothing is offered when every neighbour already agrees", () => {
  // Runs already holding the corrected value are transparent to the walk, but ticking
  // them writes nothing — so a sheet of only those is not a question worth asking.
  const candidates = plan([
    { id: "r4", value: "5.5" },
    { id: "r5", value: "5.5" },
  ]);
  assert.equal(correctionHasSomethingToOffer(candidates), false);
});

test("nothing is offered when the very next run ended the walk", () => {
  const candidates = plan([{ id: "r4", value: "9.0" }]);
  assert.equal(correctionHasSomethingToOffer(candidates), false);
});
