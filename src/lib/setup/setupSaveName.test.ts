import test from "node:test";
import assert from "node:assert/strict";
import { savedRunSetupName, teammateSetupCopyName } from "./setupSaveName";
import { chassisMatchKey, carsMatchingChassis } from "./setupCopyTargets";

test("a run at a meeting is named event then session", () => {
  assert.equal(
    savedRunSetupName({ eventName: "Kingston Classic", sessionDisplay: "Q2" }),
    "Kingston Classic · Q2"
  );
});

test("a test day keeps the session standing alone", () => {
  assert.equal(savedRunSetupName({ eventName: null, sessionDisplay: "Testing run" }), "Testing run");
  assert.equal(savedRunSetupName({ eventName: "   ", sessionDisplay: "Testing run" }), "Testing run");
});

test("a teammate's copy leads with the driver", () => {
  assert.equal(
    teammateSetupCopyName({ driverName: "Ben Smith", sessionDisplay: "Q2", trackName: "Kingston" }),
    "Ben Smith · Q2 · Kingston"
  );
});

test("a teammate's copy drops the parts it doesn't have, never the separators' worth of blanks", () => {
  assert.equal(
    teammateSetupCopyName({ driverName: null, sessionDisplay: "Q2", trackName: null }),
    "Q2"
  );
  assert.equal(
    teammateSetupCopyName({ driverName: "Ben Smith", sessionDisplay: "", trackName: "Kingston" }),
    "Ben Smith · Kingston"
  );
  assert.equal(teammateSetupCopyName({ sessionDisplay: "" }), "Teammate setup");
});

test("two cars of the same chassis model match; a different model does not", () => {
  const theirs = { setupSheetModelId: "model_x4", setupSheetTemplate: null };
  const mine = [
    { id: "a", setupSheetModelId: "model_x4", setupSheetTemplate: null },
    { id: "b", setupSheetModelId: "model_t4", setupSheetTemplate: null },
    { id: "c", setupSheetModelId: "model_x4", setupSheetTemplate: null },
  ];
  assert.deepEqual(
    carsMatchingChassis(theirs, mine).map((c) => c.id),
    ["a", "c"]
  );
});

test("a legacy A800RR car is not the same chassis as a car with no sheet at all", () => {
  const legacy = { setupSheetModelId: null, setupSheetTemplate: "awesomatix_a800rr" };
  const generic = { setupSheetModelId: null, setupSheetTemplate: null };
  assert.notEqual(chassisMatchKey(legacy), chassisMatchKey(generic));
  // Casing of the legacy id must not split one chassis into two.
  assert.equal(chassisMatchKey({ setupSheetTemplate: "Awesomatix_A800RR" }), chassisMatchKey(legacy));
});

test("cars on the generic template pair with each other", () => {
  const theirs = { setupSheetModelId: null, setupSheetTemplate: null };
  const mine = [
    { id: "a", setupSheetModelId: null, setupSheetTemplate: null },
    { id: "b", setupSheetModelId: "model_x4", setupSheetTemplate: null },
  ];
  assert.deepEqual(
    carsMatchingChassis(theirs, mine).map((c) => c.id),
    ["a"]
  );
});

test("a model id wins over a legacy template on the same car", () => {
  assert.equal(
    chassisMatchKey({ setupSheetModelId: "model_x4", setupSheetTemplate: "awesomatix_a800rr" }),
    "model:model_x4"
  );
});
