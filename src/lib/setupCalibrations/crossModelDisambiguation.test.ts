/**
 * Cross-chassis fingerprint disambiguation — the fix for the 2026-07-17 "MTC3 rendered as A800RR"
 * bug. Mugen MTC3 and Awesomatix A800RR share identical generic AcroForm field names, so an exact
 * fingerprint match is ambiguous ACROSS chassis. These tests lock the two guards:
 *   1) pickExactCalibration classifies cross-model matches distinctly (never auto-applies one).
 *   2) narrowChassisByHints resolves via file name / garage, or bails to "ask the driver".
 *
 * Run: node --conditions=react-server --import tsx src/lib/setupCalibrations/crossModelDisambiguation.test.ts
 */
import assert from "node:assert/strict";
import { pickExactCalibration, type CalibrationFingerprint } from "./autoPickCalibration";
import { narrowChassisByHints } from "./fingerprintPick";

const NAMES = ["Text1", "Text2", "Text3", "Text4"]; // shared generic AcroForm fingerprint

const mtc3: CalibrationFingerprint = {
  calibrationId: "cal-mtc3",
  calibrationName: "Mugen MTC3 VER 3101-1",
  names: NAMES,
  setupSheetModelId: "m-mtc3",
  setupSheetModelName: "Mugen MTC3",
};
const a800: CalibrationFingerprint = {
  calibrationId: "cal-a800",
  calibrationName: "A800RR_New_V1.0",
  names: NAMES,
  setupSheetModelId: "m-a800",
  setupSheetModelName: "Awesomatix A800RR",
};

// 1) Two chassis share the fingerprint → cross-model ambiguity, never a silent pick.
{
  const r = pickExactCalibration(NAMES, [mtc3, a800]);
  assert.equal(r.kind, "ambiguous_cross_model");
  if (r.kind === "ambiguous_cross_model") {
    assert.equal(r.models.length, 2);
    const names = r.models.map((m) => m.modelName).sort();
    assert.deepEqual(names, ["Awesomatix A800RR", "Mugen MTC3"]);
  }
}

// 2) Duplicate calibrations of the SAME chassis stay a plain (safe-to-suggest) ambiguity.
{
  const dup: CalibrationFingerprint = { ...mtc3, calibrationId: "cal-mtc3-b", calibrationName: "Mugen MTC3 (dup)" };
  const r = pickExactCalibration(NAMES, [mtc3, dup]);
  assert.equal(r.kind, "ambiguous");
}

// 2b) Same chassis under a duplicate model ROW (different id, same normalized name) is NOT cross-model.
{
  const dupRow: CalibrationFingerprint = { ...mtc3, calibrationId: "cal-mtc3-c", setupSheetModelId: "m-mtc3-dup" };
  const r = pickExactCalibration(NAMES, [mtc3, dupRow]);
  assert.equal(r.kind, "ambiguous");
}

// 3) Single match → exact.
{
  const r = pickExactCalibration(NAMES, [mtc3]);
  assert.equal(r.kind, "exact");
}

// 4) Unlinked-only ambiguity (no chassis to distinguish) is not cross-model.
{
  const u1: CalibrationFingerprint = { ...mtc3, setupSheetModelId: null, setupSheetModelName: null };
  const u2: CalibrationFingerprint = { ...a800, setupSheetModelId: null, setupSheetModelName: null };
  const r = pickExactCalibration(NAMES, [u1, u2]);
  assert.equal(r.kind, "ambiguous");
}

const models = [
  { modelId: "m-mtc3", modelName: "Mugen MTC3" },
  { modelId: "m-a800", modelName: "Awesomatix A800RR" },
];

// narrow: file name alone resolves (Cooper's exact case: MTC3_CW_clubdayNEW.pdf, no garage passed).
{
  const r = narrowChassisByHints(models, "MTC3_CW_clubdayNEW.pdf", undefined);
  assert.ok(r);
  assert.equal(r!.modelId, "m-mtc3");
  assert.match(r!.basis, /file name/);
}

// narrow: garage alone resolves when the file name gives nothing.
{
  const r = narrowChassisByHints(models, "setup-sheet.pdf", ["m-mtc3"]);
  assert.ok(r);
  assert.equal(r!.modelId, "m-mtc3");
  assert.match(r!.basis, /garage/);
}

// narrow: both signals agreeing → intersection basis.
{
  const r = narrowChassisByHints(models, "A800RR_final.pdf", ["m-a800"]);
  assert.ok(r);
  assert.equal(r!.modelId, "m-a800");
  assert.match(r!.basis, /file name \+ your garage/);
}

// narrow: no signal → null (ask the driver).
{
  assert.equal(narrowChassisByHints(models, "setup-sheet.pdf", undefined), null);
  assert.equal(narrowChassisByHints(models, "setup-sheet.pdf", []), null);
}

// narrow: garage owns BOTH chassis → ambiguous → null (ask).
{
  assert.equal(narrowChassisByHints(models, "setup-sheet.pdf", ["m-mtc3", "m-a800"]), null);
}

// narrow: file name mentions BOTH chassis → ambiguous → null (ask).
{
  assert.equal(narrowChassisByHints(models, "MTC3_vs_A800RR.pdf", undefined), null);
}

console.log("crossModelDisambiguation.test.ts ok");
