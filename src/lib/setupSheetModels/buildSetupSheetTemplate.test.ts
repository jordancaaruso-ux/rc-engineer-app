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
