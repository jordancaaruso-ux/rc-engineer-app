/**
 * Run: `npx tsx src/lib/setupSheetModels/enrichGroupedFieldOptions.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupedOptionValueFromLabel,
  materializeAwesomatixTemplateDefaultsOnField,
  normalizeGroupedFieldOnField,
} from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

test("groupedOptionValueFromLabel keeps numeric labels", () => {
  assert.equal(groupedOptionValueFromLabel("1", 0), "1");
  assert.equal(groupedOptionValueFromLabel("4", 3), "4");
});

test("normalizeGroupedFieldOnField does not inject Awesomatix options by key", () => {
  const field: SetupSheetModelFieldDef = {
    key: "motor_mount_screws",
    displayLabel: "Motor mount screws",
    sectionId: "tuning",
    sectionTitle: "Tuning",
    valueType: "multi",
    uiType: "multiSelect",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 0,
  };
  const out = normalizeGroupedFieldOnField(field);
  assert.equal(out.groupedOptionLabels, undefined);
});

test("normalizeGroupedFieldOnField keeps wizard-defined four options", () => {
  const field: SetupSheetModelFieldDef = {
    key: "motor_mount_screws",
    displayLabel: "Motor mount screws",
    sectionId: "tuning",
    sectionTitle: "Tuning",
    valueType: "multi",
    uiType: "multiSelect",
    groupedOptionLabels: ["1", "2", "3", "4"],
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 0,
  };
  const out = normalizeGroupedFieldOnField(field);
  assert.equal(out.groupedOptionLabels?.length, 4);
  assert.deepEqual(out.groupedOptionValues, ["1", "2", "3", "4"]);
  assert.equal(out.groupBehaviorType, "multiChoiceGroup");
});

test("materializeAwesomatixTemplateDefaultsOnField applies catalog only for platform seed", () => {
  const field: SetupSheetModelFieldDef = {
    key: "motor_mount_screws",
    displayLabel: "Motor mount screws",
    sectionId: "tuning",
    sectionTitle: "Tuning",
    valueType: "multi",
    uiType: "multiSelect",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 0,
  };
  const out = materializeAwesomatixTemplateDefaultsOnField(field);
  assert.equal(out.groupedOptionLabels?.length, 5);
  assert.equal(out.groupBehaviorType, "visualMulti");
});
