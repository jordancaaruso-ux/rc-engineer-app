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

function screwField(): SetupSheetModelFieldDef {
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

test("motor_mount_screws gains options from Awesomatix catalog when schema omits them", () => {
  const opts = modelFieldOptionEntries(screwField());
  assert.equal(opts.length, 5);
  assert.equal(opts[0]?.label, "1");
});

test("filterParametersForWidgetCount includes custom 4-option field when 4 widgets selected", () => {
  const rows = listModelParameters({
    version: 1,
    label: "Test",
    structuredSections: [],
    fields: [customFourField(), screwField()],
  });
  const eligible = filterParametersForWidgetCount(rows, 4);
  assert.ok(eligible.some((r) => r.field.key === "mount_screws"));
  assert.ok(!eligible.some((r) => r.field.key === "motor_mount_screws"));
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
