import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNewParameterField,
  existingGroupTitles,
  sectionIdForGroupTitle,
  uniqueParameterKey,
} from "@/lib/setupSheetModels/newParameterDef";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

function field(partial: Partial<SetupSheetModelFieldDef> & { key: string }): SetupSheetModelFieldDef {
  return {
    displayLabel: partial.key,
    sectionId: "general",
    sectionTitle: "General",
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 0,
    ...partial,
  };
}

function schema(fields: SetupSheetModelFieldDef[] = []): SetupSheetModelSchema {
  return { version: 1, label: "Test sheet", structuredSections: [], fields };
}

test("blank sheet: a value parameter gets a snake_case key and sort order 1", () => {
  const res = buildNewParameterField(
    { displayLabel: "Front ride height", groupTitle: "Front end", kind: "number" },
    schema()
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.field.key, "front_ride_height");
  assert.equal(res.field.valueType, "number");
  assert.equal(res.field.uiType, "text");
  assert.equal(res.field.sectionTitle, "Front end");
  assert.equal(res.field.sectionId, "front_end");
  assert.equal(res.field.sortOrder, 1);
});

test("a text value stays a single-line text field, not a textarea", () => {
  const res = buildNewParameterField(
    { displayLabel: "Front spring", groupTitle: "Springs", kind: "text" },
    schema()
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.field.valueType, "string");
  assert.equal(res.field.uiType, "text");
});

test("colliding labels get suffixed keys instead of overwriting", () => {
  const existing = schema([field({ key: "camber", sortOrder: 3 })]);
  const first = buildNewParameterField(
    { displayLabel: "Camber", groupTitle: "Geometry", kind: "number" },
    existing
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.field.key, "camber_2");
  assert.equal(first.field.sortOrder, 4);

  const both = schema([...existing.fields, first.field]);
  const second = buildNewParameterField(
    { displayLabel: "Camber", groupTitle: "Geometry", kind: "number" },
    both
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.field.key, "camber_3");
});

test("a group title already on the sheet reuses its section id", () => {
  const existing = schema([
    field({ key: "toe_front", sectionId: "front_end", sectionTitle: "Front end" }),
  ]);
  assert.equal(sectionIdForGroupTitle("front end", existing), "front_end");
  assert.equal(sectionIdForGroupTitle("FRONT END", existing), "front_end");
  assert.equal(sectionIdForGroupTitle("Diffs", existing), "diffs");
  assert.equal(sectionIdForGroupTitle("   ", existing), "general");
  // Leading digits can't start a key.
  assert.equal(sectionIdForGroupTitle("4WD bits", existing), "s_4wd_bits");
});

test("group chips list each title once, in first-seen order", () => {
  const s = schema([
    field({ key: "a", sectionTitle: "Front end" }),
    field({ key: "b", sectionTitle: "Diffs" }),
    field({ key: "c", sectionTitle: "front end" }),
    field({ key: "d", sectionTitle: "" }),
  ]);
  assert.deepEqual(existingGroupTitles(s), ["Front end", "Diffs"]);
});

test("one-of-many keeps one option per clicked box, in click order", () => {
  const res = buildNewParameterField(
    {
      displayLabel: "Front upper arm",
      groupTitle: "Front end",
      kind: "one_of_many",
      optionLabels: ["CFF", "Alloy", "Comp"],
    },
    schema()
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.field.valueType, "enum");
  assert.equal(res.field.uiType, "select");
  assert.equal(res.field.groupBehaviorType, "singleSelect");
  assert.deepEqual(res.field.groupedOptionLabels, ["CFF", "Alloy", "Comp"]);
  assert.deepEqual(res.field.groupedOptionValues, ["cff", "alloy", "comp"]);
});

test("many-of-many uses the multi-select shape", () => {
  const res = buildNewParameterField(
    {
      displayLabel: "Traction",
      groupTitle: "Session",
      kind: "many_of_many",
      optionLabels: ["Low", "High"],
    },
    schema()
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.field.valueType, "multi");
  assert.equal(res.field.groupBehaviorType, "multiChoiceGroup");
});

test("an unlabelled box falls back to its position rather than blocking the save", () => {
  const res = buildNewParameterField(
    { displayLabel: "Shim", groupTitle: "Front end", kind: "one_of_many", optionLabels: ["", "  "] },
    schema()
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.field.groupedOptionLabels, ["Option 1", "Option 2"]);
});

test("duplicate box labels are rejected — they would collapse two boxes onto one option", () => {
  const res = buildNewParameterField(
    { displayLabel: "Shim", groupTitle: "Front end", kind: "one_of_many", optionLabels: ["A", "a"] },
    schema()
  );
  assert.equal(res.ok, false);
});

test("a grouped parameter needs at least two boxes, and a name is required", () => {
  const oneBox = buildNewParameterField(
    { displayLabel: "Shim", groupTitle: "x", kind: "many_of_many", optionLabels: ["A"] },
    schema()
  );
  assert.equal(oneBox.ok, false);
  const noName = buildNewParameterField(
    { displayLabel: "   ", groupTitle: "x", kind: "number" },
    schema()
  );
  assert.equal(noName.ok, false);
});

test("a universal parameter id is carried onto the field", () => {
  const res = buildNewParameterField(
    {
      displayLabel: "Downstop (Front)",
      groupTitle: "Front end",
      kind: "number",
      universalParameterId: "droop_front",
    },
    schema()
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.field.universalParameterId, "droop_front");
});

test("uniqueParameterKey falls back for labels with no usable characters", () => {
  assert.equal(uniqueParameterKey("???", []), "custom_field");
  assert.equal(uniqueParameterKey("2 shim", []), "f_2_shim");
});
