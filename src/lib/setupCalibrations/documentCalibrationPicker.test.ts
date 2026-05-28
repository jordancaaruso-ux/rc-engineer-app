import assert from "node:assert/strict";
import { buildDocumentCalibrationPickerOptions } from "./documentCalibrationPicker";

const result = buildDocumentCalibrationPickerOptions({
  calibrations: [
    {
      id: "c1",
      name: "Mugen MTC3 VER 3101-1",
      setupSheetModelId: "m1",
      setupSheetModelName: "Mugen MTC3",
    },
    {
      id: "c2",
      name: "Orphan cal",
      setupSheetModelId: null,
      setupSheetModelName: null,
    },
  ],
  docSetupSheetModelId: "m1",
  docSetupSheetModelName: "Mugen MTC3",
  defaultCalibrationIdForDocModel: "c1",
});

assert.equal(result.matchedForDocModelCount, 1);
assert.equal(result.unlinkedCount, 1);
assert.equal(result.options[0]!.calibration.id, "c1");
assert.ok(result.options[0]!.optionLabel.includes("(default)"));
console.log("documentCalibrationPicker.test.ts ok");
