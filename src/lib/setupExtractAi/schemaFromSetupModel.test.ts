import assert from "node:assert/strict";
import { test } from "node:test";

import { buildExtractionSchemaFromModel } from "@/lib/setupExtractAi/schemaFromSetupModel";
import type { SetupSheetModelSchema, SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

function field(over: Partial<SetupSheetModelFieldDef> & { key: string }): SetupSheetModelFieldDef {
  return {
    key: over.key,
    displayLabel: over.displayLabel ?? over.key,
    sectionId: over.sectionId ?? "sec",
    sectionTitle: over.sectionTitle ?? "Section",
    valueType: over.valueType ?? "string",
    uiType: over.uiType ?? "text",
    unit: over.unit,
    showInSetupSheet: over.showInSetupSheet ?? true,
    showInAnalysis: over.showInAnalysis ?? true,
    showInLogRun: over.showInLogRun ?? true,
    sortOrder: over.sortOrder ?? 0,
    groupBehaviorType: over.groupBehaviorType,
    groupedOptionLabels: over.groupedOptionLabels,
    groupedOptionValues: over.groupedOptionValues,
  };
}

function model(fields: SetupSheetModelFieldDef[]): SetupSheetModelSchema {
  return { version: 1, label: "Test sheet", structuredSections: [], fields };
}

test("text/number fields become text extraction fields with unit in the label", () => {
  const s = buildExtractionSchemaFromModel({
    model: model([field({ key: "ride_height_front", displayLabel: "Ride height front", valueType: "number", unit: "mm" })]),
  });
  assert.equal(s.fields.length, 1);
  assert.equal(s.fields[0].valueType, "text");
  assert.equal(s.fields[0].label, "Ride height front (mm)");
  assert.equal(s.fields[0].options, undefined);
});

test("grouped single-choice field becomes a choice field with its option labels", () => {
  const s = buildExtractionSchemaFromModel({
    model: model([
      field({
        key: "chassis",
        displayLabel: "Chassis",
        valueType: "enum",
        uiType: "groupOption",
        groupBehaviorType: "singleChoiceGroup",
        groupedOptionLabels: ["Graphite", "Alu", "Alu flex"],
        groupedOptionValues: ["graphite", "alu", "alu_flex"],
      }),
    ]),
  });
  assert.equal(s.fields[0].valueType, "choice");
  assert.deepEqual(s.fields[0].options, ["Graphite", "Alu", "Alu flex"]);
});

test("lone checkbox becomes a yes/no choice", () => {
  const s = buildExtractionSchemaFromModel({
    model: model([field({ key: "solid_axle", uiType: "checkbox", valueType: "boolean" })]),
  });
  assert.equal(s.fields[0].valueType, "choice");
  assert.deepEqual(s.fields[0].options, ["yes", "no"]);
});

test("a choice-typed field with no resolvable options degrades to text (never an unconstrained choice)", () => {
  const s = buildExtractionSchemaFromModel({
    model: model([field({ key: "mystery", valueType: "enum", uiType: "select" })]),
  });
  assert.equal(s.fields[0].valueType, "text");
  assert.equal(s.fields[0].options, undefined);
});

test("fields hidden from the setup sheet are skipped by default and ordered by sortOrder", () => {
  const s = buildExtractionSchemaFromModel({
    model: model([
      field({ key: "b", sortOrder: 2 }),
      field({ key: "hidden", sortOrder: 1, showInSetupSheet: false }),
      field({ key: "a", sortOrder: 0 }),
    ]),
  });
  assert.deepEqual(s.fields.map((f) => f.key), ["a", "b"]);
});
