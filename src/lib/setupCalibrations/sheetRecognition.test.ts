import assert from "node:assert/strict";
import test from "node:test";

import {
  isUnrecognisedSheet,
  measureSheetNamePresence,
  referencedPdfFieldNames,
  SHEET_RECOGNISED_MIN_RULES,
  unrecognisedSheetMessage,
} from "./sheetRecognition";

/**
 * The two real files this check was built from, reduced to their field names.
 *
 * `A800RR_New_V1.0` names its boxes the way a PDF editor does — `Text12`, `Check Box11`. The
 * MaxMächler upload is that sheet. The Lucas Urbain upload is a rebuilt edition of the SAME sheet
 * with every box renamed to what it means, which is why it read two fields out of 235.
 */
const CALIBRATION = {
  formFieldMappings: {
    spur: { pdfFieldName: "spur" },
    pinion: { pdfFieldName: "pinion" },
    name: { pdfFieldName: "Text1" },
    date: { pdfFieldName: "Text5" },
    camber_front: { pdfFieldName: "Text12" },
    caster_front: { pdfFieldName: "Text18" },
    damping_rear: { pdfFieldName: "Text8" },
    toe_rear: { pdfFieldName: "Text6" },
    class: { pdfFieldName: "Liste déroulante4" },
    chassis: {
      mode: "singleChoiceNamedFields",
      options: [
        { value: "std", pdfFieldName: "Check Box11" },
        { value: "flex", pdfFieldName: "Check Box23" },
      ],
    },
  },
} as const;

const ORIGINAL_EDITION = [
  "spur",
  "pinion",
  "Text1",
  "Text5",
  "Text12",
  "Text18",
  "Text8",
  "Text6",
  "Liste déroulante4",
  "Check Box11",
  "Check Box23",
  "Text99",
];

const RENAMED_EDITION = [
  "spur",
  "pinion",
  "ratio",
  "BDL Length",
  "Front Camber",
  "Front Caster",
  "Rear Damping",
  "Rear Toe-In",
  "Front Ride Height",
  "Motormount Screw 1",
  "Rear Shock Oil",
  "Front Upper Hub Spacer",
];

test("option widgets inside a choice rule count as referenced names", () => {
  const names = referencedPdfFieldNames(CALIBRATION.formFieldMappings as never);
  assert.ok(names.has("Check Box11"), "nested option field name must be collected");
  assert.ok(names.has("Check Box23"));
  assert.ok(names.has("Text12"));
  assert.equal(names.size, 11);
});

test("the sheet the calibration was drawn for is recognised", () => {
  const presence = measureSheetNamePresence({
    calibrationData: CALIBRATION as never,
    pdfFieldNames: ORIGINAL_EDITION,
  });
  assert.equal(presence.referenced, 11);
  assert.equal(presence.present, 11);
  assert.equal(presence.ratio, 1);
  assert.equal(isUnrecognisedSheet(presence), false);
});

test("a rebuilt edition with renamed boxes is refused", () => {
  const presence = measureSheetNamePresence({
    calibrationData: CALIBRATION as never,
    pdfFieldNames: RENAMED_EDITION,
  });
  // Only `spur` and `pinion` are spelled the same in both editions — the real production result.
  assert.equal(presence.present, 2);
  assert.equal(presence.referenced, 11);
  assert.equal(isUnrecognisedSheet(presence), true);
});

test("a barely-filled sheet is NOT refused — presence counts names, never values", () => {
  // The whole point of measuring names: this driver has filled in almost nothing, but every box the
  // calibration names is present in the file. Refusing here would break the most ordinary upload.
  const presence = measureSheetNamePresence({
    calibrationData: CALIBRATION as never,
    pdfFieldNames: ORIGINAL_EDITION,
  });
  assert.equal(isUnrecognisedSheet(presence), false);
});

test("an edition that dropped a couple of boxes still imports", () => {
  const missingTwo = ORIGINAL_EDITION.filter((n) => n !== "Text18" && n !== "Check Box23");
  const presence = measureSheetNamePresence({
    calibrationData: CALIBRATION as never,
    pdfFieldNames: missingTwo,
  });
  assert.equal(presence.present, 9);
  assert.ok(presence.ratio > 0.5);
  assert.equal(isUnrecognisedSheet(presence), false);
});

test("the check abstains when the calibration names too few boxes to judge", () => {
  const tiny = {
    formFieldMappings: Object.fromEntries(
      Array.from({ length: SHEET_RECOGNISED_MIN_RULES - 1 }, (_, i) => [
        `k${i}`,
        { pdfFieldName: `Text${i}` },
      ])
    ),
  };
  const presence = measureSheetNamePresence({
    calibrationData: tiny as never,
    pdfFieldNames: ["nothing", "in", "common"],
  });
  assert.equal(presence.present, 0);
  assert.equal(presence.ratio, 0);
  assert.equal(isUnrecognisedSheet(presence), false, "too few rules to judge — must abstain");
});

test("a calibration with no form rules is never called unrecognised", () => {
  const presence = measureSheetNamePresence({
    calibrationData: { formFieldMappings: {} } as never,
    pdfFieldNames: ["anything"],
  });
  assert.equal(presence.referenced, 0);
  assert.equal(presence.ratio, 1);
  assert.equal(isUnrecognisedSheet(presence), false);
});

test("the driver-facing message carries the real numbers, not the word 'warnings'", () => {
  const msg = unrecognisedSheetMessage({
    presence: { referenced: 134, present: 2, ratio: 2 / 134 },
    calibrationName: "A800RR_New_V1.0",
  });
  assert.match(msg, /only 2 of the 134 boxes/);
  assert.match(msg, /A800RR_New_V1\.0/);
  assert.doesNotMatch(msg, /warning/i);
});
