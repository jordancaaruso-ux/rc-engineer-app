import assert from "node:assert/strict";
import test from "node:test";
import { planCarSwap, isSameSetupSheet } from "./carSwap";
import { isSameCarClass } from "../cars/carClasses";

test("unknown class on either side counts as same class (safe default)", () => {
  assert.equal(isSameCarClass(null, null), true);
  assert.equal(isSameCarClass("touring", null), true);
  assert.equal(isSameCarClass(null, "buggy-2wd"), true);
  assert.equal(isSameCarClass("touring", "touring"), true);
  assert.equal(isSameCarClass("touring", "buggy-2wd"), false);
});

test("same-class swap keeps tires+prep, replaces setup", () => {
  const plan = planCarSwap(
    { carClass: "touring", setupSheetModelId: "a800rr" },
    { carClass: "touring", setupSheetModelId: "a800r" },
    { setupHandEdited: false },
  );
  assert.deepEqual(plan, { rederiveTiresPrep: false, setup: "replace" });
});

test("cross-class swap re-derives tires+prep from the new car", () => {
  const plan = planCarSwap(
    { carClass: "touring", setupSheetModelId: "a800rr" },
    { carClass: "buggy-2wd", setupSheetModelId: "b74" },
    { setupHandEdited: true },
  );
  assert.deepEqual(plan, { rederiveTiresPrep: true, setup: "replace" });
});

test("hand edits survive only on the SAME setup sheet", () => {
  const a800rr = { carClass: "touring", setupSheetModelId: "a800rr" };
  const sameSheet = planCarSwap(a800rr, { ...a800rr }, { setupHandEdited: true });
  assert.equal(sameSheet.setup, "keep");
  const otherSheet = planCarSwap(
    a800rr,
    { carClass: "touring", setupSheetModelId: "a800r" },
    { setupHandEdited: true },
  );
  assert.equal(otherSheet.setup, "replace");
});

test("sheet identity falls back to the legacy template id; unknown never matches", () => {
  assert.equal(
    isSameSetupSheet(
      { setupSheetTemplate: "awesomatix_a800rr" },
      { setupSheetTemplate: "awesomatix_a800rr" },
    ),
    true,
  );
  assert.equal(isSameSetupSheet({}, {}), false);
  assert.equal(isSameSetupSheet({ setupSheetModelId: "m1" }, {}), false);
});
