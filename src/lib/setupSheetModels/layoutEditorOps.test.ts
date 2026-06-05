/**
 * Run: `npx tsx src/lib/setupSheetModels/layoutEditorOps.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addFieldToLayout,
  countCatalogFieldsMissingFromLayout,
  fieldsNotInLayout,
  removeRowFromLayout,
  reorderRow,
  reorderSections,
  rowLabel,
} from "@/lib/setupSheetModels/layoutEditorOps";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

function baseSchema(): SetupSheetModelSchema {
  return {
    version: 1,
    label: "Test",
    structuredSections: [
      {
        id: "tuning",
        title: "Tuning",
        rows: [{ type: "single", key: "camber_front", label: "Camber front" }],
      },
    ],
    fields: [
      {
        key: "camber_front",
        displayLabel: "Camber front",
        sectionId: "tuning",
        sectionTitle: "Tuning",
        valueType: "number",
        uiType: "text",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 0,
      },
      {
        key: "motor",
        displayLabel: "Motor",
        sectionId: "drivetrain",
        sectionTitle: "Drivetrain",
        valueType: "string",
        uiType: "text",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 1,
      },
    ],
  };
}

test("addFieldToLayout appends to existing section", () => {
  const next = addFieldToLayout(baseSchema(), "motor");
  assert.ok(!("error" in next));
  if ("error" in next) return;
  assert.equal(next.structuredSections.length, 2);
  const drivetrain = next.structuredSections.find((s) => s.id === "drivetrain");
  assert.equal(drivetrain?.rows.length, 1);
  assert.equal(drivetrain?.rows[0]?.type, "single");
});

test("addFieldToLayout rejects duplicate", () => {
  const result = addFieldToLayout(baseSchema(), "camber_front");
  assert.ok("error" in result);
});

test("removeRowFromLayout keeps catalog field", () => {
  const next = removeRowFromLayout(baseSchema(), "tuning", 0);
  assert.ok(!("error" in next));
  if ("error" in next) return;
  assert.equal(next.structuredSections.length, 0);
  assert.equal(next.fields.length, 2);
});

test("reorderRow moves within section", () => {
  const schema: SetupSheetModelSchema = {
    ...baseSchema(),
    structuredSections: [
      {
        id: "tuning",
        title: "Tuning",
        rows: [
          { type: "single", key: "a", label: "A" },
          { type: "single", key: "b", label: "B" },
        ],
      },
    ],
  };
  const next = reorderRow(schema, "tuning", 0, 1);
  assert.ok(!("error" in next));
  if ("error" in next) return;
  assert.equal(next.structuredSections[0]?.rows[0]?.type, "single");
  if (next.structuredSections[0]?.rows[0]?.type === "single") {
    assert.equal(next.structuredSections[0].rows[0].key, "b");
  }
});

test("reorderSections changes section order", () => {
  const schema: SetupSheetModelSchema = {
    ...baseSchema(),
    structuredSections: [
      { id: "a", title: "A", rows: [{ type: "single", key: "x", label: "X" }] },
      { id: "b", title: "B", rows: [{ type: "single", key: "y", label: "Y" }] },
    ],
  };
  const next = reorderSections(schema, 0, 1);
  assert.ok(!("error" in next));
  if ("error" in next) return;
  assert.equal(next.structuredSections[0]?.id, "b");
});

test("fieldsNotInLayout and rowLabel", () => {
  const missing = fieldsNotInLayout(baseSchema());
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.key, "motor");
  assert.equal(countCatalogFieldsMissingFromLayout(baseSchema()), 1);
  assert.equal(rowLabel({ type: "pair", label: "Camber", leftKey: "a", rightKey: "b" }), "Camber");
});
