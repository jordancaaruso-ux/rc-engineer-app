import assert from "node:assert/strict";
import {
  modelMayFeedReasoning,
  sheetMayFeedReasoning,
  sheetTrustForModel,
} from "@/lib/setupSheetModels/sheetTrust";

/** Run with `npm run test:derived-import`. */

// --- Only a curated chassis with a green-lit calibration may be read for meaning ---
assert.equal(sheetTrustForModel({ isAuthorized: true, hasGreenLitCalibration: true }), "calibrated");

// --- Every other combination is a record, including a curated chassis nobody has calibrated ---
assert.equal(sheetTrustForModel({ isAuthorized: true, hasGreenLitCalibration: false }), "record_only");
assert.equal(sheetTrustForModel({ isAuthorized: false, hasGreenLitCalibration: true }), "record_only");
assert.equal(sheetTrustForModel({ isAuthorized: false, hasGreenLitCalibration: false }), "record_only");

// --- No model at all fails closed ---
assert.equal(sheetTrustForModel(null), "record_only");
assert.equal(sheetTrustForModel(undefined), "record_only");

// --- The permission reads the same way round ---
assert.equal(sheetMayFeedReasoning("calibrated"), true);
assert.equal(sheetMayFeedReasoning("record_only"), false);
assert.equal(modelMayFeedReasoning({ isAuthorized: true, hasGreenLitCalibration: true }), true);
assert.equal(modelMayFeedReasoning(null), false);

/*
 * --- The founder's ruling, stated as a test ---
 *
 * "boxes are never 100% accurate ... only once a car is properly calibrated should anything beyond
 * that happen". A sheet derived from a driver's PDF is never authorized, so however good its box
 * names look, it is a record. Xray's `fr-shock-oil` gets no more trust than Mugen's `text91`.
 */
{
  const wellNamedDriverSheet = { isAuthorized: false, hasGreenLitCalibration: false };
  const namelessDriverSheet = { isAuthorized: false, hasGreenLitCalibration: false };
  assert.equal(sheetTrustForModel(wellNamedDriverSheet), sheetTrustForModel(namelessDriverSheet));
  assert.equal(modelMayFeedReasoning(wellNamedDriverSheet), false);
}

console.log("sheetTrust: all assertions passed");
