import assert from "node:assert/strict";
import type {
  PdfAcroFieldType,
  PdfFormFieldEntry,
  PdfFormFieldsExtraction,
} from "@/lib/setupDocuments/pdfFormFields";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { readDerivedSheetValues } from "@/lib/setupSheetModels/readDerivedSheetValues";
import { rewriteImportedCalculatedDisplayKey } from "@/lib/setup/derivedFields";

/**
 * Run with `npm run test:derived-import`.
 *
 * The load-bearing case is the last one. Everything else here is ordinary coverage.
 */

function widget(input: { index?: number; checked?: boolean }) {
  return {
    instanceIndex: input.index ?? 0,
    pageNumber: 1,
    pageWidth: 595,
    pageHeight: 842,
    x: 100,
    y: 100,
    width: 80,
    height: 14,
    ...(input.checked === undefined ? {} : { checked: input.checked }),
  };
}

function field(input: {
  name: string;
  type?: PdfAcroFieldType;
  value?: string;
  booleanValue?: boolean | null;
  widgets: Array<ReturnType<typeof widget>>;
  options?: string[];
}): PdfFormFieldEntry {
  return {
    name: input.name,
    type: input.type ?? "Text",
    value: input.value ?? "",
    booleanValue: input.booleanValue ?? null,
    widgets: input.widgets,
    pageNumber: 1,
    ...(input.options ? { options: input.options } : {}),
  };
}

function extraction(fields: PdfFormFieldEntry[]): PdfFormFieldsExtraction {
  return { hasFormFields: fields.length > 0, fields };
}

function read(
  fields: PdfFormFieldEntry[],
  formFieldMappings: Record<string, PdfFormFieldMappingRule>
) {
  return readDerivedSheetValues({ extraction: extraction(fields), formFieldMappings });
}

// --- Plain text comes back exactly as typed, trimmed ---
{
  const { values, filledCount } = read(
    [field({ name: "Text2", value: "  Sören Sparbier  ", widgets: [widget({})] })],
    { text2: { pdfFieldName: "Text2" } }
  );
  assert.equal(values.text2, "Sören Sparbier");
  assert.equal(filledCount, 1);
}

// --- An empty box is left unset, not stored as "" ---
{
  const { values, filledCount } = read([field({ name: "Text3", value: "   ", widgets: [widget({})] })], {
    text3: { pdfFieldName: "Text3" },
  });
  assert.equal("text3" in values, false, "an empty box must not be stored");
  assert.equal(filledCount, 0);
}

// --- A lone tick box stores "1" when ticked, and nothing when not ---
{
  const ticked = read([field({ name: "psl", type: "CheckBox", booleanValue: true, widgets: [widget({ checked: true })] })], {
    psl: { pdfFieldName: "psl" },
  });
  assert.equal(ticked.values.psl, "1");

  const clear = read([field({ name: "psl", type: "CheckBox", booleanValue: false, widgets: [widget({ checked: false })] })], {
    psl: { pdfFieldName: "psl" },
  });
  assert.equal("psl" in clear.values, false);
}

// --- A labelled row of ticks reports WHICH label is ticked ---
{
  const { values } = read(
    [
      field({
        name: "surface",
        type: "CheckBox",
        booleanValue: true,
        value: "on: #1",
        widgets: [widget({ index: 0, checked: false }), widget({ index: 1, checked: true }), widget({ index: 2, checked: false })],
        options: ["Asphalt", "Carpet", "Astro"],
      }),
    ],
    { surface: { pdfFieldName: "surface" } }
  );
  assert.equal(values.surface, "Carpet");
}

// --- An unlabelled row splits per box, and each box reports its own state ---
{
  const f = field({
    name: "traction-holes",
    type: "CheckBox",
    booleanValue: true,
    value: "on: #2",
    widgets: [widget({ index: 0, checked: false }), widget({ index: 1, checked: false }), widget({ index: 2, checked: true })],
  });
  const { values } = read(f ? [f] : [], {
    traction_holes__b1: { pdfFieldName: "traction-holes", widgetInstanceIndex: 0 },
    traction_holes__b2: { pdfFieldName: "traction-holes", widgetInstanceIndex: 1 },
    traction_holes__b3: { pdfFieldName: "traction-holes", widgetInstanceIndex: 2 },
  });
  assert.equal("traction_holes__b1" in values, false);
  assert.equal("traction_holes__b2" in values, false);
  assert.equal(values.traction_holes__b3, "1");
}

/*
 * --- The widget-state summary must never reach a driver's sheet ---
 *
 * `extractPdfFormFields` overwrites `value` with "all off" / "on: #0" for a multi-widget toggle.
 * It is a debugging aid. Measured on the real Xray X4'22 blank: 45 of its 178 fields report
 * "all off", and reading those as values would show a driver a sheet with 45 boxes filled in
 * reading "all off" — on a sheet they have not touched.
 */
{
  const { values, filledCount } = read(
    [
      field({
        name: "fr-caster",
        type: "CheckBox",
        booleanValue: false,
        value: "all off",
        widgets: [widget({ index: 0, checked: false }), widget({ index: 1, checked: false })],
      }),
    ],
    { fr_caster: { pdfFieldName: "fr-caster" } }
  );
  assert.equal(filledCount, 0, "an untouched row of ticks reads as nothing");
  assert.equal(JSON.stringify(values), "{}");
}

// --- A mapping pointing at a field the PDF does not have is skipped, not guessed ---
{
  const { values, filledCount } = read([field({ name: "Text2", value: "x", widgets: [widget({})] })], {
    text2: { pdfFieldName: "Text2" },
    text9: { pdfFieldName: "Text9" },
  });
  assert.equal(values.text2, "x");
  assert.equal(filledCount, 1);
}

/*
 * ================== THE REGRESSION THIS FILE EXISTS FOR ==================
 *
 * `applyPdfFormFieldMappingsFromExtraction` finishes every value through
 * `rewriteImportedCalculatedDisplayKey`, which hard-codes `text91` and `text93` to Awesomatix
 * spring-rate keys. A sheet with Acrobat-default field names derives keys in exactly that
 * namespace — the whole Mugen MTC3 is `text2` … `text142`.
 *
 * First: prove the trap is real, so this test fails loudly if someone ever "simplifies" the
 * derived path back onto the shared reader.
 */
assert.notEqual(
  rewriteImportedCalculatedDisplayKey("text91"),
  "text91",
  "the shared import path still rewrites text91 — this reader must keep avoiding it"
);
assert.notEqual(rewriteImportedCalculatedDisplayKey("text93"), "text93");

// Then: prove this reader does NOT do it. The driver's box 91 stays their box 91.
{
  const { values } = read(
    [
      field({ name: "Text91", value: "23.4", widgets: [widget({})] }),
      field({ name: "Text93", value: "450", widgets: [widget({})] }),
    ],
    { text91: { pdfFieldName: "Text91" }, text93: { pdfFieldName: "Text93" } }
  );
  assert.equal(values.text91, "23.4", "box 91 must stay box 91");
  assert.equal(values.text93, "450", "box 93 must stay box 93");
  assert.equal(Object.keys(values).sort().join(","), "text91,text93");
}

// A key that merely looks like a spring rate is also left alone.
{
  const { values } = read([field({ name: "front-spring-rate", value: "310", widgets: [widget({})] })], {
    front_spring_rate: { pdfFieldName: "front-spring-rate" },
  });
  assert.equal(values.front_spring_rate, "310");
}

console.log("readDerivedSheetValues: all assertions passed");
