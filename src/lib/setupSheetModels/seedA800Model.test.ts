/**
 * Run: `npx tsx src/lib/setupSheetModels/seedA800Model.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeMissingA800CatalogFields } from "@/lib/setupSheetModels/mergeA800CatalogFields";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

function field(key: string) {
  return {
    key,
    displayLabel: key,
    sectionId: "tuning",
    sectionTitle: "Tuning",
    valueType: "string" as const,
    uiType: "text" as const,
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 0,
  };
}

function schemaWithLayout(rows: SetupSheetModelSchema["structuredSections"]): SetupSheetModelSchema {
  return {
    version: 1,
    label: "A800",
    structuredSections: rows,
    fields: [field("camber_front"), field("camber_rear")],
  };
}

test("mergeMissingA800CatalogFields adds catalog fields only", () => {
  const existing = schemaWithLayout([
    { id: "custom", title: "My order", rows: [{ type: "single", key: "camber_rear", label: "Rear first" }] },
  ]);
  const seed: SetupSheetModelSchema = {
    ...existing,
    fields: [...existing.fields, field("motor_pinion")],
  };

  const merged = mergeMissingA800CatalogFields(existing, seed);
  assert.ok(merged);
  assert.equal(merged.fields.length, 3);
  assert.deepEqual(merged.structuredSections, existing.structuredSections);
});

test("mergeMissingA800CatalogFields returns null when nothing to add", () => {
  const existing = schemaWithLayout([
    { id: "tuning", title: "Tuning", rows: [{ type: "single", key: "camber_front", label: "Camber" }] },
  ]);
  assert.equal(mergeMissingA800CatalogFields(existing, existing), null);
});
