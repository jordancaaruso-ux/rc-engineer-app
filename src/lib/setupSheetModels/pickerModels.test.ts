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

test("dedupe collapses by normalized name and keeps the best row", () => {
  const out = dedupeSetupSheetModelsForPicker([
    row({ id: "a", name: "Mugen MTC3", carCount: 9, calibrationCount: 0 }),
    row({ id: "b", name: "mugen  mtc3", carCount: 0, calibrationCount: 2, slug: "mugen_mtc3_1" }),
    row({ id: "c", name: "Xray T4", slug: "xray_t4", carCount: 1, calibrationCount: 0 }),
  ]);
  const ids = out.map((m) => m.id).sort();
  assert.deepEqual(ids, ["b", "c"]);
});
