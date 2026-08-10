import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfFormFields, type PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import { DEBUG_SHEET_BLANKS } from "@/lib/setupSheetModels/debugSheetBlanks";
import { SETUP_DOCUMENT_MAX_BYTES } from "@/lib/setupDocuments/types";
import {
  MAX_BLANK_FIELDS,
  MAX_BLANK_PAGES,
  refusalForBlankExtraction,
  refusalForBlankFile,
} from "@/lib/setupSheetModels/blankUploadDiagnosis";

function fakeExtraction(input: Partial<PdfFormFieldsExtraction>): PdfFormFieldsExtraction {
  return { hasFormFields: true, fields: [], pageCount: 1, ...input };
}

function fakeFields(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `f${i}`,
    type: "Text",
    value: "",
    widgets: [],
    pageNumber: 1,
  }));
}

// --- File-level checks happen before a byte is read, so a wrong pick never reaches storage ---
{
  assert.equal(refusalForBlankFile({ byteSize: 1000, mimeType: "application/pdf" }), null);
  // A browser that sends no type at all is not evidence of anything — do not refuse on silence.
  assert.equal(refusalForBlankFile({ byteSize: 1000, mimeType: "" }), null);
  assert.equal(refusalForBlankFile({ byteSize: 1000, mimeType: null }), null);

  assert.equal(refusalForBlankFile({ byteSize: 1000, mimeType: "image/jpeg" })?.code, "NOT_A_PDF");
  assert.equal(refusalForBlankFile({ byteSize: 0, mimeType: "application/pdf" })?.code, "EMPTY_FILE");
  const big = refusalForBlankFile({ byteSize: SETUP_DOCUMENT_MAX_BYTES + 1, mimeType: "application/pdf" });
  assert.equal(big?.code, "TOO_BIG");
  assert.match(big!.message, /12 MB/, "the size in the message must be the size we enforce");

  // Picking the wrong file is not a chassis problem, so it must not offer the no-sheet car or land
  // in the founder's queue.
  for (const code of ["NOT_A_PDF", "EMPTY_FILE", "TOO_BIG"]) {
    const r =
      code === "NOT_A_PDF"
        ? refusalForBlankFile({ byteSize: 10, mimeType: "image/png" })
        : code === "EMPTY_FILE"
          ? refusalForBlankFile({ byteSize: 0 })
          : refusalForBlankFile({ byteSize: SETUP_DOCUMENT_MAX_BYTES + 1 });
    assert.equal(r?.offerCarWithoutSheet, false, `${code} should not offer the no-sheet car`);
    assert.equal(r?.status, null, `${code} should not reach the review queue`);
  }
}

// --- A file that was plausibly their real sheet always leaves them somewhere to go ---
{
  const flat = refusalForBlankExtraction({
    extraction: fakeExtraction({ hasFormFields: false }),
    boxCount: 0,
  });
  assert.equal(flat?.code, "NOT_FILLABLE");
  assert.equal(flat?.status, "NOT_FILLABLE", "kept, so the founder can make it fillable himself");
  assert.equal(flat?.offerCarWithoutSheet, true);
  // Never call it a scan: most of these are crisp PDFs that simply have no boxes, and being told
  // your file is a photo when it plainly is not reads as the app not knowing what it is looking at.
  assert.doesNotMatch(flat!.message, /scan/i);

  // A form layer whose widgets all sit off-page derives to nothing — same outcome, same words.
  const noBoxes = refusalForBlankExtraction({
    extraction: fakeExtraction({ hasFormFields: true, fields: fakeFields(3) }),
    boxCount: 0,
  });
  assert.equal(noBoxes?.code, "NOT_FILLABLE");

  const locked = refusalForBlankExtraction({
    extraction: fakeExtraction({ hasFormFields: false, loadError: "encrypted" }),
    boxCount: 0,
  });
  assert.equal(locked?.code, "UNREADABLE");
  assert.equal(locked?.status, "UNREADABLE");
  assert.equal(locked?.offerCarWithoutSheet, true);
}

// --- The product-manual guards fire before anything is written ---
{
  const pages = refusalForBlankExtraction({
    extraction: fakeExtraction({ fields: fakeFields(5), pageCount: MAX_BLANK_PAGES + 1 }),
    boxCount: 5,
  });
  assert.equal(pages?.code, "TOO_MANY_PAGES");
  assert.match(pages!.message, new RegExp(String(MAX_BLANK_PAGES + 1)), "say the number we counted");

  assert.equal(
    refusalForBlankExtraction({
      extraction: fakeExtraction({ fields: fakeFields(5), pageCount: MAX_BLANK_PAGES }),
      boxCount: 5,
    }),
    null,
    "the limit itself is allowed"
  );

  const many = refusalForBlankExtraction({
    extraction: fakeExtraction({ fields: fakeFields(MAX_BLANK_FIELDS + 1) }),
    boxCount: MAX_BLANK_FIELDS + 1,
  });
  assert.equal(many?.code, "TOO_MANY_BOXES");

  // A file with no stated page count is treated as one page rather than refused.
  assert.equal(
    refusalForBlankExtraction({
      extraction: { hasFormFields: true, fields: fakeFields(2) },
      boxCount: 2,
    }),
    null
  );
}

// --- The real manufacturer blanks, which are the whole point, are all accepted ---
async function realFiles() {
  for (const [id, blank] of Object.entries(DEBUG_SHEET_BLANKS)) {
    const path = join(process.cwd(), blank.path);
    const bytes = readFileSync(path);

    assert.equal(
      refusalForBlankFile({ byteSize: bytes.byteLength, mimeType: "application/pdf" }),
      null,
      `${id}: refused on the file alone`
    );

    const extraction = await extractPdfFormFields(bytes);
    const derived = deriveSchemaFromAcroForm(extraction, blank.label);
    const r = refusalForBlankExtraction({ extraction, boxCount: derived.boxes.length });
    assert.equal(r, null, `${id}: refused — ${r?.message ?? ""}`);
    // Both limits must sit clear of the busiest real sheet, or the guard is the thing that breaks.
    assert.ok(extraction.fields.length < MAX_BLANK_FIELDS, `${id}: too close to the box limit`);
    assert.ok((extraction.pageCount ?? 1) <= MAX_BLANK_PAGES, `${id}: too close to the page limit`);
  }

  // The Xray '26 sheet ships in two forms, and the non-editable one is exactly what a driver will
  // reach for by mistake — it looks identical on screen and has no form layer at all.
  const flatPath = join(
    process.cwd(),
    "scripts/setup-extract-eval/gold/xray-x4-2026/files/x4_2026_set_up_blank.pdf"
  );
  const flat = await extractPdfFormFields(readFileSync(flatPath));
  assert.equal(flat.hasFormFields, false, "fixture changed: this file is meant to have no form layer");
  const refused = refusalForBlankExtraction({ extraction: flat, boxCount: 0 });
  assert.equal(refused?.code, "NOT_FILLABLE");
  assert.equal(refused?.offerCarWithoutSheet, true, "they still have a car to add");
}

void realFiles().then(() => console.log("blankUploadDiagnosis.test.ts ok"));
