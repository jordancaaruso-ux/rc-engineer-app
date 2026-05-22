/**
 * Run: `npx tsx src/lib/setupSheetModels/enrichGroupedFieldOptions.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enrichGroupedOptionsOnField,
  groupedOptionValueFromLabel,
} from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

test("groupedOptionValueFromLabel keeps numeric labels", () => {
  assert.equal(groupedOptionValueFromLabel("1", 0), "1");
  assert.equal(groupedOptionValueFromLabel("4", 3), "4");
});

test("enrichGroupedOptionsOnField fills motor_mount_screws from Awesomatix catalog", () => {
  const field: SetupSheetModelFieldDef = {
    key: "motor_mount_screws",
    displayLabel: "Motor mount screws",
    sectionId: "tuning",
    sectionTitle: "Tuning",
    valueType: "multi",
    uiType: "multiSelect",
    showInSetupSheet: true,
    showInAnalysis: true,
    sortOrder: 0,
  };
  const out = enrichGroupedOptionsOnField(field);
  assert.equal(out.groupedOptionLabels?.length, 5);
  assert.equal(out.groupBehaviorType, "visualMulti");
  assert.deepEqual(out.groupedOptionValues, ["1", "2", "3", "4", "5"]);
});
