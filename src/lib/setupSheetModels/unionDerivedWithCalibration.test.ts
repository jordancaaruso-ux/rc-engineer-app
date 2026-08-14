import assert from "node:assert/strict";
import test from "node:test";

import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import {
  claimedWidgetsFromMappings,
  unionDerivedWithCalibration,
} from "@/lib/setupSheetModels/unionDerivedWithCalibration";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

function widget(instanceIndex: number) {
  return {
    instanceIndex,
    pageNumber: 1,
    pageWidth: 1000,
    pageHeight: 1400,
    x: 100 + instanceIndex * 60,
    y: 200 + instanceIndex * 30,
    width: 50,
    height: 20,
  };
}

function extraction(
  fields: Array<{ name: string; widgets: number; type?: string; options?: string[] }>
): PdfFormFieldsExtraction {
  return {
    hasFormFields: true,
    pageCount: 1,
    fields: fields.map((f) => ({
      name: f.name,
      type: f.type ?? "Text",
      value: "",
      pageNumber: 1,
      ...(f.options ? { options: f.options } : {}),
      ...(f.type === "CheckBox" ? { booleanValue: false } : {}),
      widgets: Array.from({ length: f.widgets }, (_, i) => widget(i)),
    })),
  };
}

function field(p: Partial<SetupSheetModelFieldDef> & { key: string }): SetupSheetModelFieldDef {
  return {
    displayLabel: p.key,
    sectionId: "s",
    sectionTitle: "S",
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 1,
    ...p,
  } as SetupSheetModelFieldDef;
}

test("a box the calibration owns is left alone; the rest get keys", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([
      { name: "Texte2", widgets: 1 },
      { name: "Texte3", widgets: 1 },
    ]),
    schema: { fields: [field({ key: "camber_front" })] },
    formFieldMappings: {
      camber_front: { pdfFieldName: "Texte2" } as PdfFormFieldMappingRule,
    },
    label: "A800RR",
  });

  assert.deepEqual(Object.keys(result.mappings), ["texte3"]);
  assert.deepEqual(result.boxes.map((b) => b.key), ["texte3"]);
  assert.deepEqual(result.fields.map((f) => f.key), ["texte3"]);
  // Nothing anywhere near `camber_front` — the calibration's box was excluded, not re-derived.
  assert.equal(result.fields.some((f) => f.key.startsWith("camber")), false);
});

/**
 * The permanent-key hazard, pinned. `Texte2` slugifies to `texte2`; if a calibrated chassis already
 * had a parameter of that name the derivation would hand two parameters the same key and the second
 * would silently overwrite the first in every saved setup.
 */
test("a derived key can never land on a key the chassis already uses", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([{ name: "Texte2", widgets: 1 }]),
    schema: { fields: [field({ key: "texte2" }), field({ key: "camber_front" })] },
    // `texte2` the SCHEMA key is a different parameter from the `Texte2` PDF field; nothing maps it.
    formFieldMappings: { camber_front: { pdfFieldName: "other" } as PdfFormFieldMappingRule },
    label: "A800RR",
  });

  assert.deepEqual(result.fields.map((f) => f.key), ["texte2_2"]);
  assert.deepEqual(result.stats.collidedKeys, ['texte2 (PDF field "Texte2")']);
});

test("unnamed boxes stay out of the log-run form and out of analysis", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([{ name: "Text42", widgets: 1 }]),
    schema: { fields: [] },
    formFieldMappings: {},
    label: "MTC3",
  });

  const f = result.fields[0]!;
  assert.equal(f.showInLogRun, false);
  assert.equal(f.showInAnalysis, false);
  assert.equal(f.showInSetupSheet, true);
  // The name says nothing, so the label is where the box sits — the only honest thing to say.
  assert.match(f.displayLabel, /^Box 1 · page 1/);
});

/**
 * A printed one-of-many row is ONE parameter over several boxes. Deriving the boxes the calibration
 * didn't happen to list would give the driver two controls for one answer on the same row.
 */
test("a choice row the calibration maps is claimed whole, not box by box", () => {
  const claimed = claimedWidgetsFromMappings({
    diff_height_front: {
      mode: "singleChoiceWidgetGroup",
      pdfFieldName: "Check Box6",
      options: { low: { widgetInstanceIndex: 0 }, high: { widgetInstanceIndex: 1 } },
    } as PdfFormFieldMappingRule,
  });
  assert.deepEqual(claimed, [{ pdfFieldName: "Check Box6" }]);

  const result = unionDerivedWithCalibration({
    extraction: extraction([
      { name: "Check Box6", widgets: 3, type: "CheckBox", options: ["Low", "Mid", "High"] },
    ]),
    schema: { fields: [field({ key: "diff_height_front" })] },
    formFieldMappings: {
      diff_height_front: {
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Check Box6",
        options: { low: { widgetInstanceIndex: 0 }, high: { widgetInstanceIndex: 1 } },
      } as PdfFormFieldMappingRule,
    },
    label: "A800RR",
  });
  assert.deepEqual(result.fields, []);
});

/**
 * `acroField` with no `widgetInstanceIndex` means the whole field. Reading it as "widget 0" would
 * leave the siblings of a text field printed in three places derivable, and the same value would
 * then appear under two keys.
 */
test("a whole-field mapping claims every one of its boxes", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([{ name: "fr-offset", widgets: 3 }]),
    schema: { fields: [field({ key: "front_offset" })] },
    formFieldMappings: { front_offset: { pdfFieldName: "fr-offset" } as PdfFormFieldMappingRule },
    label: "A800RR",
  });
  assert.deepEqual(result.fields, []);
});

test("one box of a multi-box field can be claimed, leaving its siblings derivable", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([{ name: "fr-offset", widgets: 3 }]),
    schema: { fields: [field({ key: "front_offset" })] },
    formFieldMappings: {
      front_offset: { pdfFieldName: "fr-offset", widgetInstanceIndex: 1 } as PdfFormFieldMappingRule,
    },
    label: "A800RR",
  });
  assert.deepEqual(result.fields.map((f) => f.key), ["fr_offset__b1", "fr_offset__b3"]);
});

test("the hand-written supplements claim their boxes too", () => {
  const claimed = claimedWidgetsFromMappings({}, { front_spring_rate_gf_mm: "Text91" });
  assert.deepEqual(claimed, [{ pdfFieldName: "Text91" }]);

  const result = unionDerivedWithCalibration({
    extraction: extraction([{ name: "Text91", widgets: 1 }]),
    schema: { fields: [field({ key: "front_spring_rate_gf_mm" })] },
    formFieldMappings: {},
    extraSimpleKeys: { front_spring_rate_gf_mm: "Text91" },
    label: "A800RR",
  });
  assert.deepEqual(result.fields, []);
});

/**
 * The ordinary form sorts on `sortOrder`. Numbering the additions from 1 would thread ~70 unnamed
 * boxes through the driver's own parameters on any chassis that falls back to the field list.
 */
test("added parameters sort after everything already on the chassis", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([{ name: "Text42", widgets: 1 }]),
    schema: { fields: [field({ key: "camber_front", sortOrder: 57 })] },
    formFieldMappings: {},
    label: "A800RR",
  });
  assert.equal(result.fields[0]!.sortOrder, 58);
});

/*
 * ================= THE CALIBRATION NAMED A KEY THE SCHEMA NEVER DECLARED =================
 *
 * Measured on the A800RR, 2026-08-14: eight of its calibration's keys — date, name, race, class,
 * track, country, air_temp, track_temp — had no schema field, so `boxesFromCalibrationMappings`
 * skipped them and the printed header strip drew blank and exported blank.
 */
test("a mapped key the schema never declared gets a parameter and a box", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([
      { name: "Text1", widgets: 1 },
      { name: "Text99", widgets: 1 },
    ]),
    schema: { fields: [field({ key: "camber_front", sortOrder: 12 })] },
    formFieldMappings: { name: { pdfFieldName: "Text1" } as PdfFormFieldMappingRule },
    label: "A800RR",
  });

  assert.deepEqual(result.calibrationOnlyKeys, ["name"]);
  const minted = result.fields.find((f) => f.key === "name");
  assert.ok(minted, "the missing key becomes a parameter");
  assert.equal(minted.displayLabel, "Name");
  // Document metadata, not tuning: a track name must never read as a setup change.
  assert.equal(minted.showInLogRun, false);
  assert.equal(minted.showInAnalysis, false);
  assert.equal(minted.showInSetupSheet, true);
  assert.ok(result.boxes.some((b) => b.key === "name"), "and gets geometry on the paper");

  // Its rule stays the calibration's — copying it into the derived map would give one box two readers.
  assert.equal(result.mappings.name, undefined);
  // The derived box for the unclaimed field still sorts after everything, header included.
  const derived = result.fields.find((f) => f.key !== "name")!;
  assert.ok(derived.sortOrder > minted.sortOrder);
});

test("keys the schema already declares are left alone, so a second run adds nothing", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([{ name: "Text1", widgets: 1 }]),
    schema: { fields: [field({ key: "name" })] },
    formFieldMappings: { name: { pdfFieldName: "Text1" } as PdfFormFieldMappingRule },
    label: "A800RR",
  });
  assert.deepEqual(result.calibrationOnlyKeys, []);
  assert.deepEqual(result.fields, []);
  assert.deepEqual(result.boxes, []);
});

test("a mapped choice row the schema lacks keeps its options rather than becoming free text", () => {
  const result = unionDerivedWithCalibration({
    extraction: extraction([{ name: "Surface", widgets: 2, type: "CheckBox" }]),
    schema: { fields: [] },
    formFieldMappings: {
      surface: {
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Surface",
        options: { Carpet: { widgetInstanceIndex: 0 }, Asphalt: { widgetInstanceIndex: 1 } },
      } as PdfFormFieldMappingRule,
    },
    label: "A800RR",
  });
  const minted = result.fields.find((f) => f.key === "surface")!;
  assert.equal(minted.valueType, "enum");
  assert.deepEqual(minted.groupedOptionValues, ["Carpet", "Asphalt"]);
  // One box per printed choice, each carrying which option it stands for.
  assert.deepEqual(
    result.boxes.filter((b) => b.key === "surface").map((b) => b.optionValue),
    ["Carpet", "Asphalt"]
  );
});
