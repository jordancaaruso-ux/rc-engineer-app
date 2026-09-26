import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadedSheetFailed,
  uploadedSheetStatusWords,
  uploadedSheetTitle,
} from "@/lib/setupDocuments/uploadedSheetStatus";

test("a read sheet says so, and says when its setup was saved", () => {
  // Was "PARSED · COMPLETED_WITH_WARNINGS (database_save_completed) · setup created".
  assert.equal(
    uploadedSheetStatusWords({ parseStatus: "PARSED", importStatus: "COMPLETED_WITH_WARNINGS", createdSetupId: "s1" }),
    "Read · setup saved"
  );
  assert.equal(uploadedSheetStatusWords({ parseStatus: "PARTIAL", importStatus: "COMPLETED" }), "Read");
});

test("an upload that became a chassis sheet says so, never PENDING", () => {
  // A blank's document is never parsed, so it sits at PENDING for ever.
  const blank = { parseStatus: "PENDING", importStatus: "COMPLETED", blankSheet: { setupSheetModelId: "m1" } };
  assert.equal(uploadedSheetStatusWords(blank), "Became your chassis sheet");
  assert.equal(uploadedSheetFailed(blank), false);
  // Refused: no chassis came of it, and the founder follows it up.
  assert.equal(
    uploadedSheetStatusWords({ ...blank, blankSheet: { setupSheetModelId: null } }),
    "Waiting for review"
  );
});

test("a chassis's source sheet is named by the chassis, not the store's prefix", () => {
  assert.equal(uploadedSheetTitle("BLANK - Serpent X20"), "Serpent X20");
  assert.equal(uploadedSheetTitle("X20 setup Sat.pdf"), "X20 setup Sat.pdf");
});

test("reading, failed and waiting read as words", () => {
  assert.equal(uploadedSheetStatusWords({ parseStatus: "PENDING", importStatus: "PROCESSING" }), "Reading…");
  assert.equal(uploadedSheetStatusWords({ parseStatus: "PARTIAL", importStatus: "FAILED" }), "Couldn't be read");
  assert.equal(uploadedSheetStatusWords({ parseStatus: "FAILED", importStatus: "COMPLETED" }), "Couldn't be read");
  assert.equal(uploadedSheetFailed({ parseStatus: "FAILED" }), true);
  // A sheet style nobody has taught the app yet waits for the founder.
  assert.equal(uploadedSheetStatusWords({ parseStatus: "PENDING", importStatus: "PENDING" }), "Waiting for review");
});
