import assert from "node:assert/strict";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";
import {
  derivedSheetFingerprint,
  derivedSheetSlug,
  isDerivedSheetSlug,
} from "@/lib/setupSheetModels/derivedSheetFingerprint";

/** Run with `npm run test:derived-import`. */

function fieldDef(key: string): SetupSheetModelFieldDef {
  return {
    key,
    displayLabel: key,
    sectionId: "grp_other",
    sectionTitle: "Other",
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInLogRun: false,
    showInAnalysis: false,
    sortOrder: 1,
  };
}

function sheet(pairs: Array<[string, PdfFormFieldMappingRule]>) {
  return {
    schema: { fields: pairs.map(([key]) => fieldDef(key)) },
    formFieldMappings: Object.fromEntries(pairs),
  };
}

const BASE: Array<[string, PdfFormFieldMappingRule]> = [
  ["text2", { pdfFieldName: "Text2" }],
  ["text6", { pdfFieldName: "Text6" }],
  ["surface__b1", { pdfFieldName: "surface", widgetInstanceIndex: 0 }],
  ["surface__b2", { pdfFieldName: "surface", widgetInstanceIndex: 1 }],
];

// --- The same derivation always hashes the same ---
assert.equal(derivedSheetFingerprint(sheet(BASE)), derivedSheetFingerprint(sheet(BASE)));

// --- Renaming a key changes it. Keys are permanent, so a different key set is a different sheet ---
{
  const renamed = BASE.map<[string, PdfFormFieldMappingRule]>(([k, r]) => (k === "text6" ? ["text7", r] : [k, r]));
  assert.notEqual(derivedSheetFingerprint(sheet(BASE)), derivedSheetFingerprint(sheet(renamed)));
}

// --- Pointing a key at a different box changes it ---
{
  const moved = BASE.map<[string, PdfFormFieldMappingRule]>(([k, r]) =>
    k === "text6" ? [k, { pdfFieldName: "Text9" }] : [k, r]
  );
  assert.notEqual(derivedSheetFingerprint(sheet(BASE)), derivedSheetFingerprint(sheet(moved)));
}

// --- Two boxes of one field are told apart by their widget index ---
{
  const collapsed = BASE.map<[string, PdfFormFieldMappingRule]>(([k, r]) =>
    k === "surface__b2" ? [k, { pdfFieldName: "surface", widgetInstanceIndex: 0 }] : [k, r]
  );
  assert.notEqual(derivedSheetFingerprint(sheet(BASE)), derivedSheetFingerprint(sheet(collapsed)));
}

/*
 * --- ORDER is part of the identity ---
 *
 * The order is the order the fill flow sweeps the sheet in, so two sheets whose boxes run
 * differently are not the same sheet to a driver — even with an identical key set.
 */
{
  const reordered = [BASE[1]!, BASE[0]!, BASE[2]!, BASE[3]!];
  assert.notEqual(derivedSheetFingerprint(sheet(BASE)), derivedSheetFingerprint(sheet(reordered)));
}

/*
 * --- Separators: no run-together collision ---
 *
 * Without a separator between key and mapping, "ab" + "c" and "a" + "bc" hash alike, which is the
 * one way two genuinely different sheets could be pulled onto one shared row.
 */
{
  const a = sheet([["ab", { pdfFieldName: "c" }]]);
  const b = sheet([["a", { pdfFieldName: "bc" }]]);
  assert.notEqual(derivedSheetFingerprint(a), derivedSheetFingerprint(b));
}

// --- A missing mapping is recorded, not silently treated as absent ---
{
  const orphan = { schema: { fields: [fieldDef("text2")] }, formFieldMappings: {} };
  const mapped = sheet([["text2", { pdfFieldName: "Text2" }]]);
  assert.notEqual(derivedSheetFingerprint(orphan), derivedSheetFingerprint(mapped));
}

// --- Slugs round-trip and are recognisable ---
{
  const fp = derivedSheetFingerprint(sheet(BASE));
  assert.match(fp, /^[0-9a-f]{16}$/, "fingerprint is 16 hex characters");
  assert.equal(derivedSheetSlug(fp), `sheet_${fp}`);
  assert.equal(isDerivedSheetSlug(derivedSheetSlug(fp)), true);
}

// --- Curated catalog slugs must never read as derived, or they would vanish from the picker ---
for (const slug of ["mugen_mtc3", "xray_x4", "awesomatix_a800rr", "tamiya_trf421", "universal_touring"]) {
  assert.equal(isDerivedSheetSlug(slug), false, `${slug} is a curated chassis, not a derived sheet`);
}
assert.equal(isDerivedSheetSlug(null), false);
assert.equal(isDerivedSheetSlug(undefined), false);

console.log("derivedSheetFingerprint: all assertions passed");
