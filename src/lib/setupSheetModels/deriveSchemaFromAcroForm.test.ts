import assert from "node:assert/strict";
import type {
  PdfAcroFieldType,
  PdfFormFieldEntry,
  PdfFormFieldsExtraction,
} from "@/lib/setupDocuments/pdfFormFields";
import {
  deriveSchemaFromAcroForm,
  isGenericAcroFieldName,
  labelFromAcroFieldName,
} from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import {
  DERIVED_KEY_RESERVED_SUFFIX,
  isReservedSetupKey,
  reservedSafeDerivedKey,
} from "@/lib/setupSheetModels/reservedSetupKeys";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";

let widgetSeq = 0;
function widget(input: { page?: number; x?: number; y?: number; index?: number }) {
  return {
    instanceIndex: input.index ?? 0,
    pageNumber: input.page ?? 1,
    pageWidth: 595,
    pageHeight: 842,
    x: input.x ?? 100,
    y: input.y ?? (widgetSeq += 20),
    width: 80,
    height: 14,
  };
}

function field(input: {
  name: string;
  type?: PdfAcroFieldType;
  widgets: Array<ReturnType<typeof widget>>;
  options?: string[];
}): PdfFormFieldEntry {
  return {
    name: input.name,
    type: input.type ?? "Text",
    value: "",
    widgets: input.widgets,
    pageNumber: input.widgets[0]?.pageNumber ?? 1,
    ...(input.options ? { options: input.options } : {}),
  };
}

function extraction(fields: PdfFormFieldEntry[]): PdfFormFieldsExtraction {
  return { hasFormFields: fields.length > 0, fields };
}

// --- Generic-name detection: the whole Mugen sheet is `Text2`…`Text142` ---
for (const n of ["Text2", "text47", "Check Box9", "Field1", "Untitled3", "x423", "Button1"]) {
  assert.equal(isGenericAcroFieldName(n), true, `${n} should read as generic`);
}
for (const n of ["fr-shock-oil", "pinion", "fdr", "traction", "re-lenght"]) {
  assert.equal(isGenericAcroFieldName(n), false, `${n} should read as meaningful`);
}

// --- Labels stay honest: tidy the punctuation, never expand an abbreviation ---
assert.equal(labelFromAcroFieldName("fr-shock-oil"), "Fr shock oil");
assert.equal(labelFromAcroFieldName("frontRollBar"), "Front roll bar");
assert.equal(labelFromAcroFieldName("pinion"), "Pinion");

// --- Every widget becomes exactly one fillable box, and every box is addressable ---
{
  const ex = extraction([
    field({ name: "fr-camber", widgets: [widget({ y: 100 })] }),
    field({ name: "re-camber", widgets: [widget({ y: 120 })] }),
    field({
      name: "surface",
      type: "CheckBox",
      widgets: [widget({ y: 140, x: 100, index: 0 }), widget({ y: 140, x: 200, index: 1 })],
    }),
  ]);
  const { schema, formFieldMappings, stats } = deriveSchemaFromAcroForm(ex, "Test sheet");

  assert.equal(schema.fields.length, 4, "2 single boxes + a 2-box checkbox row = 4 parameters");
  assert.equal(stats.parameterCount, 4);
  assert.equal(new Set(schema.fields.map((f) => f.key)).size, 4, "keys are unique");
  for (const f of schema.fields) {
    assert.ok(formFieldMappings[f.key], `${f.key} must map back to a box on the paper`);
  }

  // Reader order: down the page, then across. A driver filling the sheet follows the paper.
  const order = schema.fields.map((f) => f.sortOrder);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.deepEqual(
    schema.fields.map((f) => f.key),
    ["fr_camber", "re_camber", "surface__b1", "surface__b2"]
  );

  // Nothing here may claim to know what a box MEANS — that is the naming step, done by a human.
  for (const f of schema.fields) assert.equal(f.universalParameterId, undefined);
}

// --- REGRESSION (found on the real Xray blanks 2026-08-10) ---
// `fr-offset` has several boxes, so a `${name}_${index}` split suffix produced `fr_offset_1` —
// which the sheet ALSO uses as a real, separate field name. One of the two then carried a `_2`
// disambiguator forever. Keys are permanent, so this had to be structurally impossible, not lucky.
{
  const ex = extraction([
    field({
      name: "fr-offset",
      type: "CheckBox",
      widgets: [widget({ y: 200, x: 100, index: 0 }), widget({ y: 200, x: 150, index: 1 }), widget({ y: 200, x: 200, index: 2 })],
    }),
    field({ name: "fr-offset-1", widgets: [widget({ y: 220 })] }),
    field({ name: "fr-offset-2", widgets: [widget({ y: 240 })] }),
  ]);
  const { schema, stats } = deriveSchemaFromAcroForm(ex, "Collision sheet");

  assert.equal(stats.collisionCount, 0, `no key should need a disambiguator: ${stats.collidedKeys.join(", ")}`);
  const keys = schema.fields.map((f) => f.key);
  assert.ok(keys.includes("fr_offset_1"), "the real field keeps the key its own name implies");
  assert.ok(keys.includes("fr_offset_2"));
  assert.ok(keys.includes("fr_offset__b1"), "split boxes use a suffix a field name cannot produce");
  assert.equal(new Set(keys).size, keys.length);
}

// --- A box nobody has named is usable, but never spoken about as if it were understood ---
{
  const ex = extraction([
    field({ name: "Text47", widgets: [widget({ page: 2, x: 40, y: 60 })] }),
    field({ name: "fr-shock-oil", widgets: [widget({ page: 2, x: 40, y: 90 })] }),
  ]);
  const { schema, stats } = deriveSchemaFromAcroForm(ex, "Mixed sheet");
  const unnamed = schema.fields.find((f) => f.key === "text47")!;
  const named = schema.fields.find((f) => f.key === "fr_shock_oil")!;

  assert.equal(stats.placeholderLabelCount, 1);
  assert.match(unnamed.displayLabel, /^Box 1 · page 2, upper left$/, "says where it is on the paper");
  assert.equal(unnamed.showInAnalysis, false, "an unnamed box must not reach the Engineer");
  assert.equal(named.displayLabel, "Fr shock oil");
  assert.equal(named.showInAnalysis, true);

  // 200 questions is not a log-run flow.
  for (const f of schema.fields) assert.equal(f.showInLogRun, false);
  // But every box is fillable — that is the point of Tier 1.
  for (const f of schema.fields) assert.equal(f.showInSetupSheet, true);
}

// --- A single tick box out of a row is not an answer on its own ---
{
  const ex = extraction([
    field({
      name: "traction",
      type: "CheckBox",
      widgets: [widget({ y: 300, x: 100, index: 0 }), widget({ y: 300, x: 150, index: 1 }), widget({ y: 300, x: 200, index: 2 })],
    }),
  ]);
  const { schema } = deriveSchemaFromAcroForm(ex, "Ticks");
  assert.equal(schema.fields.length, 3);
  for (const f of schema.fields) {
    assert.equal(f.showInAnalysis, false, "which of three ticks is on means nothing until merged");
    assert.match(f.displayLabel, /^Traction · box \d of 3$/);
  }
}

// --- When the PDF states its own choices, they are used rather than split apart ---
{
  const ex = extraction([
    field({
      name: "Text88",
      type: "CheckBox",
      widgets: [widget({ y: 400, x: 100, index: 0 }), widget({ y: 400, x: 150, index: 1 }), widget({ y: 400, x: 200, index: 2 })],
      options: ["Soft", "Medium", "Hard"],
    }),
  ]);
  const { schema, stats } = deriveSchemaFromAcroForm(ex, "Dropdown sheet");
  assert.equal(schema.fields.length, 1, "a stated choice list stays one parameter");
  assert.equal(stats.withOptionsCount, 1);
  assert.deepEqual(schema.fields[0]!.groupedOptionLabels, ["Soft", "Medium", "Hard"]);
  assert.equal(schema.fields[0]!.groupBehaviorType, "singleChoiceGroup");
}

// --- A text field with several boxes is several places to write, never a choice ---
{
  const ex = extraction([
    field({
      name: "notes",
      type: "Text",
      widgets: [widget({ y: 500, index: 0 }), widget({ y: 520, index: 1 })],
      options: ["a", "b"],
    }),
  ]);
  const { schema } = deriveSchemaFromAcroForm(ex, "Text multi");
  assert.equal(schema.fields.length, 2, "two boxes to type in, not one two-way choice");
}

// --- Fields with no box on any page cannot be filled, so they are not parameters ---
{
  const ex = extraction([
    field({ name: "orphan", widgets: [] }),
    field({ name: "real", widgets: [widget({ y: 600 })] }),
  ]);
  const { schema } = deriveSchemaFromAcroForm(ex, "Orphans");
  assert.equal(schema.fields.length, 1);
  assert.equal(schema.fields[0]!.key, "real");
}

// --- An empty or unreadable PDF is an empty sheet, not a crash ---
{
  const { schema, stats } = deriveSchemaFromAcroForm(extraction([]), "Empty");
  assert.equal(schema.fields.length, 0);
  assert.equal(stats.parameterCount, 0);
  assert.equal(schema.label, "Empty");
}

// --- A derived box must store what the driver typed, not what the app would do to that name ---
//
// The proof is the round trip, not the key: `normalizeSetupSnapshotForStorage` is the one write path
// for every saved setup, and for a handful of names it rewrites the value rather than storing it.
// A manufacturer sheet with a box called "Camber front" is entirely ordinary, and before the guard
// a driver typing 2.5 into it got -2.5 back — permanently, since the key freezes on first save.
{
  const ex = extraction([
    field({ name: "Camber front", widgets: [widget({ y: 100 })] }),
    field({ name: "Toe rear", widgets: [widget({ y: 120 })] }),
    field({ name: "Chassis", widgets: [widget({ y: 140 })] }),
    field({ name: "chassis_other", widgets: [widget({ y: 160 })] }),
    field({ name: "Traction", widgets: [widget({ y: 180 })] }),
    field({ name: "Top deck screws", widgets: [widget({ y: 200 })] }),
    field({ name: "Tires", widgets: [widget({ y: 220 })] }),
    field({ name: "Additive", widgets: [widget({ y: 240 })] }),
    field({ name: "fr-shock-oil", widgets: [widget({ y: 260 })] }),
  ]);
  const { schema, stats, formFieldMappings } = deriveSchemaFromAcroForm(ex, "Reserved names");
  const keys = schema.fields.map((f) => f.key);

  assert.equal(stats.reservedKeyCount, 8, `expected 8 suffixed: ${stats.reservedKeys.join(", ")}`);
  for (const k of keys) {
    assert.equal(isReservedSetupKey(k), false, `${k} must not claim a key the app rewrites`);
  }
  assert.ok(keys.includes("camber_front__s"));
  assert.ok(keys.includes("chassis_other__s"), "a preset companion key is DROPPED on save, not just rewritten");
  assert.ok(keys.includes("fr_shock_oil"), "an ordinary name is left exactly as it was");

  // Every suffixed box still maps back to its box on the paper.
  for (const f of schema.fields) assert.ok(formFieldMappings[f.key], `${f.key} lost its mapping`);

  // The round trip: what the driver typed is what comes back.
  const typed = Object.fromEntries(keys.map((k, i) => [k, String(i + 1)]));
  const stored = normalizeSetupSnapshotForStorage({ ...typed, camber_front__s: "2.5" });
  assert.equal(stored.camber_front__s, "2.5", "sign rule must not reach a derived box");
  for (const k of keys) {
    assert.equal(typeof stored[k], "string", `${k} came back as ${typeof stored[k]}, not the text typed`);
  }
}

// --- Unreserved names are untouched, and the suffix cannot land on a second reserved key ---
{
  for (const k of ["fr_shock_oil", "text47", "pinion", "fdr", "re_lenght"]) {
    assert.equal(reservedSafeDerivedKey(k), k, `${k} is free for the taking`);
  }
  for (const k of ["camber_front", "chassis", "tires", "traction", "additive", "top_deck_cuts"]) {
    assert.equal(reservedSafeDerivedKey(k), `${k}${DERIVED_KEY_RESERVED_SUFFIX}`);
    assert.equal(isReservedSetupKey(reservedSafeDerivedKey(k)), false, "suffixing must terminate");
  }
  // The suffix is safe only because a field name cannot produce a doubled underscore — the same
  // property `__b<n>` relies on. If a reserved key ever contains one, both suffixes stop being safe.
  assert.equal(DERIVED_KEY_RESERVED_SUFFIX.startsWith("__"), true);
}

// --- A split box already carries `__b<n>`, so it was never reserved and must not gain a suffix ---
{
  const ex = extraction([
    field({
      name: "traction",
      type: "CheckBox",
      widgets: [widget({ y: 300, x: 100, index: 0 }), widget({ y: 300, x: 150, index: 1 })],
    }),
  ]);
  const { schema, stats } = deriveSchemaFromAcroForm(ex, "Split reserved");
  assert.equal(stats.reservedKeyCount, 0);
  assert.deepEqual(
    schema.fields.map((f) => f.key),
    ["traction__b1", "traction__b2"]
  );
}

console.log("deriveSchemaFromAcroForm.test.ts ok");
