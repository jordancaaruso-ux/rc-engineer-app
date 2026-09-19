import assert from "node:assert/strict";
import test from "node:test";
import { planCarSwap, isSameSetupSheet } from "./carSwap";
import { isSamePlatform } from "../cars/carClasses";
import { platformForChassisSlug } from "../cars/chassisPlatform";

test("unknown platform on either side counts as the same platform (safe default)", () => {
  assert.equal(isSamePlatform(null, null), true);
  assert.equal(isSamePlatform("touring", null), true);
  assert.equal(isSamePlatform(null, "buggy-2wd"), true);
  assert.equal(isSamePlatform("touring", "touring"), true);
  assert.equal(isSamePlatform("touring", "buggy-2wd"), false);
});

test("platform is inferred from the chassis slug; unknown chassis stays null", () => {
  assert.equal(platformForChassisSlug("awesomatix_a800rr"), "touring~electric");
  assert.equal(platformForChassisSlug("xray_x4"), "touring~electric");
  assert.equal(platformForChassisSlug("mugen_mtc3"), "touring~electric");
  // User-created duplicates are slug-suffixed but are still the same platform.
  assert.equal(platformForChassisSlug("mugen_mtc3_2"), "touring~electric");
  // Not in the curated catalog → unknown, which isSamePlatform treats as "same".
  assert.equal(platformForChassisSlug("some_users_own_chassis"), null);
  assert.equal(platformForChassisSlug(null), null);
  assert.equal(platformForChassisSlug(""), null);
});

test("every car today resolves to the same platform, so a swap keeps tires", () => {
  // Regression guard for the 2026-07-22 change: dropping the Car.carClass picker must not start
  // re-deriving tires. All catalog chassis are touring, so any swap between them carries.
  const plan = planCarSwap(
    { platform: platformForChassisSlug("awesomatix_a800rr"), setupSheetModelId: "a800rr" },
    { platform: platformForChassisSlug("xray_x4"), setupSheetModelId: "x4" },
    { setupHandEdited: false },
  );
  assert.deepEqual(plan, { rederiveTiresPrep: false, setup: "replace" });
});

test("a car with no known chassis still keeps tires across a swap", () => {
  const plan = planCarSwap(
    { platform: null, setupSheetModelId: "custom" },
    { platform: "touring", setupSheetModelId: "a800rr" },
    { setupHandEdited: false },
  );
  assert.equal(plan.rederiveTiresPrep, false);
});

test("same-platform swap keeps tires+prep, replaces setup", () => {
  const plan = planCarSwap(
    { platform: "touring", setupSheetModelId: "a800rr" },
    { platform: "touring", setupSheetModelId: "a800r" },
    { setupHandEdited: false },
  );
  assert.deepEqual(plan, { rederiveTiresPrep: false, setup: "replace" });
});

test("cross-platform swap re-derives tires+prep from the new car", () => {
  const plan = planCarSwap(
    { platform: "touring", setupSheetModelId: "a800rr" },
    { platform: "buggy-2wd", setupSheetModelId: "b74" },
    { setupHandEdited: true },
  );
  assert.deepEqual(plan, { rederiveTiresPrep: true, setup: "replace" });
});

test("hand edits survive only on the SAME setup sheet", () => {
  const a800rr = { platform: "touring", setupSheetModelId: "a800rr" };
  const sameSheet = planCarSwap(a800rr, { ...a800rr }, { setupHandEdited: true });
  assert.equal(sameSheet.setup, "keep");
  const otherSheet = planCarSwap(
    a800rr,
    { platform: "touring", setupSheetModelId: "a800r" },
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
