/**
 * Run: `npx tsx src/lib/setupSheetModels/modelCalibrationMapping.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGroupedRuleFromAssignments,
  filterParametersForWidgetCount,
  groupedBehaviorForAssignments,
  listModelParameters,
  modelFieldOptionEntries,
} from "@/lib/setupSheetModels/modelCalibrationMapping";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

function screwFieldWithoutOptions(): SetupSheetModelFieldDef {
  return {
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
}

function customFourField(): SetupSheetModelFieldDef {
  return {
    key: "mount_screws",
    displayLabel: "Mount screws",
    sectionId: "tuning",
    sectionTitle: "Tuning",
    valueType: "multi",
    uiType: "multiSelect",
    groupBehaviorType: "multiChoiceGroup",
    groupedOptionLabels: ["1", "2", "3", "4"],
    groupedOptionValues: ["1", "2", "3", "4"],
    showInSetupSheet: true,
    showInAnalysis: true,
    sortOrder: 1,
  };
}

test("modelFieldOptionEntries uses schema only when options omitted on key", () => {
  const opts = modelFieldOptionEntries(screwFieldWithoutOptions());
  assert.equal(opts.length, 0);
});

test("filterParametersForWidgetCount includes wizard 4-option field when 4 widgets selected", () => {
  const fourOnMotorKey: SetupSheetModelFieldDef = {
    ...screwFieldWithoutOptions(),
    groupedOptionLabels: ["1", "2", "3", "4"],
    groupedOptionValues: ["1", "2", "3", "4"],
    groupBehaviorType: "multiChoiceGroup",
  };
  const rows = listModelParameters({
    version: 1,
    label: "Test",
    structuredSections: [],
    fields: [customFourField(), screwFieldWithoutOptions(), fourOnMotorKey],
  });
  const eligible = filterParametersForWidgetCount(rows, 4);
  assert.ok(eligible.some((r) => r.field.key === "mount_screws"));
  const motorEligible = eligible.find((r) => r.field.key === "motor_mount_screws");
  assert.ok(motorEligible);
  assert.equal(motorEligible!.field.groupedOptionLabels?.length, 4);
  assert.equal(modelFieldOptionEntries(screwFieldWithoutOptions()).length, 0);
});

test("groupedBehaviorForAssignments uses visualMulti when widgets share one pdf field name", () => {
  const field = customFourField();
  const assignments = ["1", "2", "3", "4"].map((v, i) => ({
    optionValue: v,
    optionLabel: v,
    sourceKey: `ScrewRow#${i}`,
  }));
  const behavior = groupedBehaviorForAssignments(field, assignments);
  assert.equal(behavior, "visualMulti");
  const rule = buildGroupedRuleFromAssignments(behavior, assignments);
  assert.ok(rule && "mode" in rule && rule.mode === "multiSelectWidgetGroup");
});
