import assert from "node:assert/strict";
import { test } from "node:test";

import { assessBlankSheetCalibrationFit } from "@/lib/setupSheetModels/blankSheetCalibrationFit";

const keys = (n: number, prefix = "k") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test("same sheet re-run: identical keys fit", () => {
  const k = keys(40);
  const fit = assessBlankSheetCalibrationFit(k, k);
  assert.equal(fit.ok, true);
  assert.equal(fit.coverage, 1);
  assert.equal(fit.matchedKeys.length, 40);
});

test("driver unticked fields last time: PDF maps MORE keys than the model kept — still fits", () => {
  // The model kept 20 of the sheet's 40 boxes; the same PDF still maps all 40.
  const fit = assessBlankSheetCalibrationFit(keys(40), keys(20));
  assert.equal(fit.ok, true);
  assert.equal(fit.coverage, 1);
});

test("a different chassis' sheet is refused", () => {
  const fit = assessBlankSheetCalibrationFit(keys(40, "xray_"), keys(40, "mugen_"));
  assert.equal(fit.ok, false);
  assert.match(fit.reason, /different sheet|too few/);
});

test("partial overlap below the coverage bar is refused", () => {
  // 12 of 40 model keys present (30%) — above the absolute floor, below the ratio gate.
  const fit = assessBlankSheetCalibrationFit([...keys(12), ...keys(30, "other")], keys(40));
  assert.equal(fit.ok, false);
  assert.equal(fit.matchedKeys.length, 12);
  assert.match(fit.reason, /30% of this model's fields/);
});

test("three quarters of the sheet is not enough — that is a different sheet", () => {
  // Raised past half on founder's call 2026-08-11. The same sheet re-run covers ~100%, so a
  // quarter of the chassis missing is a different sheet rather than a near miss.
  const fit = assessBlankSheetCalibrationFit(keys(30), keys(40));
  assert.equal(fit.ok, false, "75% must not pass");
  assert.match(fit.reason, /75% of this model's fields/);
});

test("a revision that moved a handful of boxes still fits", () => {
  const fit = assessBlankSheetCalibrationFit(keys(36), keys(40));
  assert.equal(fit.ok, true, "90% is the same sheet with a few boxes changed");
});

test("tiny overlap on a small schema is refused by the absolute floor", () => {
  // 4 of 6 keys = 67% coverage, which clears the ratio — but 4 keys is not evidence.
  const fit = assessBlankSheetCalibrationFit(keys(4), keys(6));
  assert.equal(fit.ok, false);
  assert.match(fit.reason, /too few/);
});

test("a model with no fields is refused rather than dividing by zero", () => {
  const fit = assessBlankSheetCalibrationFit(keys(40), []);
  assert.equal(fit.ok, false);
  assert.equal(fit.coverage, 0);
});

test("duplicate model keys do not inflate coverage", () => {
  const fit = assessBlankSheetCalibrationFit(keys(10), [...keys(10), ...keys(10)]);
  assert.equal(fit.ok, true);
  assert.equal(fit.matchedKeys.length, 10);
  assert.equal(fit.coverage, 1);
});
