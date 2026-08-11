import assert from "node:assert/strict";
import { test } from "node:test";

import { calibrationOpensUploadDoor } from "@/lib/setupCalibrations/uploadDoorRule";

const pdfCal = (opts: { mappings?: number; greenLit?: boolean } = {}) => {
  const formFieldMappings: Record<string, unknown> = {};
  for (let i = 0; i < (opts.mappings ?? 0); i++) {
    formFieldMappings[`param_${i}`] = { pdfFieldName: `Text${i}`, widgetInstanceIndex: 0 };
  }
  return {
    templateType: "pdf_form_fields",
    formFieldMappings,
    fieldMappings: {},
    fields: {},
    ...(opts.greenLit ? { verification: { greenLitAt: "2026-07-22T00:00:00.000Z" } } : {}),
  };
};

test("a chassis derived from its own blank PDF opens the door, green light or not", () => {
  // This is the Xray X4'26 case: created from the driver's blank, every box mapped from the file's
  // own form layer, nobody has named a thing. It reads a filled copy of that sheet exactly.
  assert.equal(calibrationOpensUploadDoor(pdfCal({ mappings: 289 })), true);
});

test("a half-mapped hand-authored calibration still opens the door", () => {
  // The July gate refused this, on the grounds that a partial read is worse than none. The read is
  // now drawn on the driver's own sheet, so the boxes it missed are visibly empty.
  assert.equal(calibrationOpensUploadDoor(pdfCal({ mappings: 12 })), true);
});

test("an empty calibration does not — there is nothing to read the sheet with", () => {
  assert.equal(calibrationOpensUploadDoor(pdfCal({ mappings: 0 })), false);
});

test("an image calibration does not open the door, green light or not", () => {
  // No image sheet can be uploaded anywhere any more, so an image map has nothing to read. A door
  // that opens onto a file type the next screen refuses is worse than a closed one.
  const imageCal = (greenLit: boolean) => ({
    templateType: "image_regions",
    imageCalibration: { widthPx: 1000, heightPx: 1400, fields: [] },
    ...(greenLit ? { verification: { greenLitAt: "2026-07-22T00:00:00.000Z" } } : {}),
  });
  assert.equal(calibrationOpensUploadDoor(imageCal(true)), false);
  assert.equal(calibrationOpensUploadDoor(imageCal(false)), false);
});

test("the green light alone never opens it — that is the Engineer's question", () => {
  assert.equal(calibrationOpensUploadDoor(pdfCal({ mappings: 0, greenLit: true })), false);
});

test("junk is refused rather than thrown on", () => {
  assert.equal(calibrationOpensUploadDoor(null), false);
  assert.equal(calibrationOpensUploadDoor(undefined), false);
  assert.equal(calibrationOpensUploadDoor("not a calibration"), false);
  assert.equal(calibrationOpensUploadDoor({}), false);
});
