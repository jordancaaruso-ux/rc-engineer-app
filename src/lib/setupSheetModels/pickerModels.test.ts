/**
 * Run: `npx tsx src/lib/setupSheetModels/pickerModels.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dedupeSetupSheetModelsForPicker,
  recommendedSetupSheetModelIds,
  setupSheetModelPickerScore,
  type SetupSheetModelPickerRow,
} from "@/lib/setupSheetModels/pickerModels";

function row(p: Partial<SetupSheetModelPickerRow> & { id: string }): SetupSheetModelPickerRow {
  return {
    name: "Mugen MTC3",
    slug: "mugen_mtc3",
    carCount: 0,
    calibrationCount: 0,
    ...p,
  };
}

test("a calibrated duplicate beats an uncalibrated one with more cars", () => {
  const carsNoCal = row({ id: "cars", carCount: 5, calibrationCount: 0 });
  const oneCal = row({ id: "cal", carCount: 0, calibrationCount: 1, slug: "mugen_mtc3_1" });
  assert.ok(setupSheetModelPickerScore(oneCal) > setupSheetModelPickerScore(carsNoCal));

  const kept = recommendedSetupSheetModelIds([carsNoCal, oneCal]);
  assert.equal(kept.has("cal"), true);
  assert.equal(kept.has("cars"), false);
});

test("among calibrated rows, more cars wins", () => {
  const a = row({ id: "a", carCount: 1, calibrationCount: 1 });
  const b = row({ id: "b", carCount: 3, calibrationCount: 1, slug: "mugen_mtc3_1" });
  assert.ok(setupSheetModelPickerScore(b) > setupSheetModelPickerScore(a));
});

test("canonical slug breaks ties over suffixed duplicate", () => {
  const canonical = row({ id: "canon", carCount: 2, calibrationCount: 1, slug: "mugen_mtc3" });
  const suffixed = row({ id: "suf", carCount: 2, calibrationCount: 1, slug: "mugen_mtc3_1" });
  assert.ok(setupSheetModelPickerScore(canonical) > setupSheetModelPickerScore(suffixed));
});

test("the curated row wins even against a driver-authored row with everything else", () => {
  // The case that matters once drivers can author their own chassis types, which go live for
  // everyone: a user row that has picked up a calibration and cars must not become the row the
  // whole app resolves for "Mugen MTC3", or scoped fingerprint matching silently targets it.
  const curated = row({ id: "curated", isAuthorized: true, carCount: 0, calibrationCount: 0 });
  const userMade = row({
    id: "user",
    isAuthorized: false,
    carCount: 5,
    calibrationCount: 1,
    slug: "mugen_mtc3_1",
  });
  assert.ok(setupSheetModelPickerScore(curated) > setupSheetModelPickerScore(userMade));

  const kept = recommendedSetupSheetModelIds([userMade, curated]);
  assert.equal(kept.has("curated"), true);
  assert.equal(kept.has("user"), false);
});

test("authorization does not disturb ordering among rows that share it", () => {
  const a = row({ id: "a", isAuthorized: true, carCount: 1, calibrationCount: 1 });
  const b = row({ id: "b", isAuthorized: true, carCount: 3, calibrationCount: 1, slug: "mugen_mtc3_1" });
  assert.ok(setupSheetModelPickerScore(b) > setupSheetModelPickerScore(a));
});

test("an absent isAuthorized is treated as unauthorized", () => {
  const unknown = row({ id: "unknown", carCount: 9, calibrationCount: 2 });
  const curated = row({ id: "curated", isAuthorized: true, slug: "mugen_mtc3_1" });
  assert.ok(setupSheetModelPickerScore(curated) > setupSheetModelPickerScore(unknown));
});

test("dedupe collapses by normalized name and keeps the best row", () => {
  const out = dedupeSetupSheetModelsForPicker([
    row({ id: "a", name: "Mugen MTC3", carCount: 9, calibrationCount: 0 }),
    row({ id: "b", name: "mugen  mtc3", carCount: 0, calibrationCount: 2, slug: "mugen_mtc3_1" }),
    row({ id: "c", name: "Xray T4", slug: "xray_t4", carCount: 1, calibrationCount: 0 }),
  ]);
  const ids = out.map((m) => m.id).sort();
  assert.deepEqual(ids, ["b", "c"]);
});
