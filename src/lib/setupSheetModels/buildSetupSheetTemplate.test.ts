/**
 * Run: `npx tsx src/lib/setupSheetModels/buildSetupSheetTemplate.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSetupSheetTemplateFromParsedSchema } from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

test("buildFieldChipOptionsFromSchema includes stored option values", () => {
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "Mugen MTC3",
    structuredSections: [
      {
        id: "tuning",
        title: "Tuning",
        rows: [{ type: "single", key: "arb_rear", label: "ARB rear" }],
      },
    ],
    fields: [
      {
        key: "arb_rear",
        displayLabel: "ARB rear",
        sectionId: "tuning",
        sectionTitle: "Tuning",
        valueType: "enum",
        uiType: "select",
        groupedOptionLabels: ["1.1", "1.2"],
        groupedOptionValues: ["f_1_1", "f_1_2"],
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 0,
      },
    ],
  };
  const tpl = buildSetupSheetTemplateFromParsedSchema("m1", "Mugen MTC3", schema);
  assert.deepEqual(tpl.fieldChipOptionsByKey?.arb_rear, {
    options: ["1.1", "1.2"],
    optionValues: ["f_1_1", "f_1_2"],
    multi: false,
  });
});

test("logRun view filters structured sections by showInLogRun", () => {
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "Test",
    structuredSections: [
      {
        id: "geo",
        title: "Geometry",
        rows: [
          { type: "single", key: "motor", label: "Motor" },
          { type: "pair", label: "Camber", unit: "°", leftKey: "camber_front", rightKey: "camber_rear" },
        ],
      },
    ],
    fields: [
      {
        key: "motor",
        displayLabel: "Motor",
        sectionId: "geo",
        sectionTitle: "Geometry",
        valueType: "string",
        uiType: "text",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: false,
        sortOrder: 0,
      },
      {
        key: "camber_front",
        displayLabel: "Camber front",
        sectionId: "geo",
        sectionTitle: "Geometry",
        valueType: "number",
        uiType: "text",
        unit: "°",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 1,
      },
      {
        key: "camber_rear",
        displayLabel: "Camber rear",
        sectionId: "geo",
        sectionTitle: "Geometry",
        valueType: "number",
        uiType: "text",
        unit: "°",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: false,
        sortOrder: 2,
      },
    ],
  };

  const setupTpl = buildSetupSheetTemplateFromParsedSchema("m1", "Test", schema, "setup");
  assert.equal(setupTpl.structuredSections?.[0]?.rows.length, 2);

  const logRunTpl = buildSetupSheetTemplateFromParsedSchema("m1", "Test", schema, "logRun");
  assert.equal(logRunTpl.structuredSections?.length, 1);
  assert.equal(logRunTpl.structuredSections?.[0]?.rows.length, 1);
  assert.equal(logRunTpl.structuredSections?.[0]?.rows[0]?.type, "pair");
  assert.equal(logRunTpl.groups?.[0]?.fields.length, 1);
  assert.equal(logRunTpl.groups?.[0]?.fields[0]?.key, "camber_front");
});

test("logRun view keeps layout rows whose keys lack field defs", () => {
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "Test",
    structuredSections: [
      {
        id: "geo",
        title: "Geometry",
        rows: [{ type: "single", key: "orphan_layout_key", label: "Orphan" }],
      },
    ],
    fields: [],
  };
  const logRunTpl = buildSetupSheetTemplateFromParsedSchema("m1", "Test", schema, "logRun");
  assert.equal(logRunTpl.structuredSections?.[0]?.rows.length, 1);
});
