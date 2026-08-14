/**
 * The bundler renames pdf-lib's classes. Reading a box's kind must not care.
 *
 * The bug this pins, from prod on 2026-08-14: `extractPdfFormFields` asked each field
 * `constructor.name`, which is `"PDFCheckBox"` under `tsx` and `"e"` in the Vercel build, because
 * `pdf-lib` is bundled and minified there. Every comparison against `"CheckBox"` failed, so every
 * box a driver derived from their own sheet became a free-text box and no row of ticks ever became
 * a one-of-many. Every local test passed the whole time — which is exactly why this one renames the
 * classes itself rather than trusting the unminified name.
 *
 * `Function.name` is configurable, so this reproduces the bundler's effect exactly: same objects,
 * same code path, names mangled. Restored afterwards so nothing downstream sees the change.
 *
 *   npx tsx --conditions=react-server src/lib/setupDocuments/pdfFormFields.minified.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFButton, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from "pdf-lib";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import { DEBUG_SHEET_BLANKS } from "@/lib/setupSheetModels/debugSheetBlanks";

const CLASSES = [PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFButton];

function withMangledClassNames<T>(run: () => Promise<T>): Promise<T> {
  const originals = CLASSES.map((c) => Object.getOwnPropertyDescriptor(c, "name"));
  CLASSES.forEach((c, i) => {
    Object.defineProperty(c, "name", { value: `m${i}`, configurable: true });
  });
  return run().finally(() => {
    CLASSES.forEach((c, i) => {
      const d = originals[i];
      if (d) Object.defineProperty(c, "name", d);
    });
  });
}

async function main() {
  const blank = DEBUG_SHEET_BLANKS["xray-x4-2026"];
  const bytes = readFileSync(join(process.cwd(), blank.path));

  const mangled = await withMangledClassNames(async () => {
    const extraction = await extractPdfFormFields(bytes);
    assert.equal(PDFCheckBox.name, "m1", "the test failed to mangle anything, so it proves nothing");
    return extraction;
  });

  const types = new Set(mangled.fields.map((f) => f.type));
  assert.ok(types.has("CheckBox"), `no tick boxes survived renaming — saw ${[...types].join(", ")}`);
  assert.ok(types.has("Text"), `no text boxes survived renaming — saw ${[...types].join(", ")}`);
  assert.equal(types.has("Unknown"), false, "a field kind went unrecognised");

  // The count is what the real file holds, so a future reading that merely *looks* plausible under
  // renaming still has to agree with the sheet.
  const checkBoxes = mangled.fields.filter((f) => f.type === "CheckBox").length;
  assert.equal(checkBoxes, 94, "the Xray '26 blank has 94 tick-box fields");

  const derived = deriveSchemaFromAcroForm(mangled, blank.label);
  const checkboxParams = derived.schema.fields.filter((f) => f.uiType === "checkbox").length;
  assert.equal(checkboxParams, 182, "tick boxes must still derive as ticks, not as lines to type on");

  console.log(`pdfFormFields.minified.test.ts ok (${checkBoxes} tick fields → ${checkboxParams} tick boxes)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
