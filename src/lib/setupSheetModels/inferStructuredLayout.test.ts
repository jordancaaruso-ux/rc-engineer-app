/**
 * Run: `npx tsx src/lib/setupSheetModels/inferStructuredLayout.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inferSectionLayoutRows,
  inferStructuredLayoutFromFields,
} from "@/lib/setupSheetModels/inferStructuredLayout";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

function field(
  partial: Partial<SetupSheetModelFieldDef> & Pick<SetupSheetModelFieldDef, "key" | "displayLabel">
): SetupSheetModelFieldDef {
  return {
    sectionId: "suspension",
    sectionTitle: "Suspension",
    valueType: "number",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 0,
    ...partial,
  };
}

test("groups _ff/_fr/_rf/_rr into corner4 row", () => {
  const fields = [
    field({ key: "upper_link_ff", displayLabel: "Upper link FF", sortOrder: 0, unit: "mm" }),
    field({ key: "upper_link_fr", displayLabel: "Upper link FR", sortOrder: 1, unit: "mm" }),
    field({ key: "upper_link_rf", displayLabel: "Upper link RF", sortOrder: 2, unit: "mm" }),
    field({ key: "upper_link_rr", displayLabel: "Upper link RR", sortOrder: 3, unit: "mm" }),
  ];
  const rows = inferSectionLayoutRows(fields);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.type, "corner4");
  if (rows[0]?.type === "corner4") {
    assert.equal(rows[0].label, "Upper link");
    assert.equal(rows[0].ff, "upper_link_ff");
    assert.equal(rows[0].fr, "upper_link_fr");
    assert.equal(rows[0].rf, "upper_link_rf");
    assert.equal(rows[0].rr, "upper_link_rr");
    assert.equal(rows[0].unit, "mm");
  }
});

test("groups _front/_rear into pair row", () => {
  const fields = [
    field({ key: "camber_front", displayLabel: "Camber (Front)", sortOrder: 0, unit: "°" }),
    field({ key: "camber_rear", displayLabel: "Camber (Rear)", sortOrder: 1, unit: "°" }),
  ];
  const rows = inferSectionLayoutRows(fields);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.type, "pair");
  if (rows[0]?.type === "pair") {
    assert.equal(rows[0].label, "Camber");
    assert.equal(rows[0].leftKey, "camber_front");
    assert.equal(rows[0].rightKey, "camber_rear");
  }
});

test("corner4 takes priority over partial keys; incomplete set stays single", () => {
  const fields = [
    field({ key: "shim_ff", displayLabel: "Shim FF", sortOrder: 0 }),
    field({ key: "shim_fr", displayLabel: "Shim FR", sortOrder: 1 }),
    field({ key: "notes", displayLabel: "Notes", sortOrder: 2, uiType: "textarea", valueType: "string" }),
  ];
  const rows = inferSectionLayoutRows(fields);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.type, "single");
  assert.equal(rows[1]?.type, "single");
  assert.equal(rows[2]?.type, "single");
});

test("inferStructuredLayoutFromFields rebuilds stacked singles into corner4", () => {
  const fields = [
    field({ key: "upper_link_ff", displayLabel: "Upper link FF", sortOrder: 0 }),
    field({ key: "upper_link_fr", displayLabel: "Upper link FR", sortOrder: 1 }),
    field({ key: "upper_link_rf", displayLabel: "Upper link RF", sortOrder: 2 }),
    field({ key: "upper_link_rr", displayLabel: "Upper link RR", sortOrder: 3 }),
  ];
  const existing = [
    {
      id: "suspension",
      title: "Suspension",
      rows: [
        { type: "single" as const, key: "upper_link_ff", label: "Upper link FF" },
        { type: "single" as const, key: "upper_link_fr", label: "Upper link FR" },
        { type: "single" as const, key: "upper_link_rf", label: "Upper link RF" },
        { type: "single" as const, key: "upper_link_rr", label: "Upper link RR" },
      ],
    },
  ];
  const sections = inferStructuredLayoutFromFields(fields, existing);
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.rows.length, 1);
  assert.equal(sections[0]?.rows[0]?.type, "corner4");
});

test("mixed corner4, pair, and single in sort order", () => {
  const fields = [
    field({ key: "camber_front", displayLabel: "Camber (Front)", sortOrder: 0 }),
    field({ key: "camber_rear", displayLabel: "Camber (Rear)", sortOrder: 1 }),
    field({ key: "upper_inner_shims_ff", displayLabel: "Upper inner shims FF", sortOrder: 2 }),
    field({ key: "upper_inner_shims_fr", displayLabel: "Upper inner shims FR", sortOrder: 3 }),
    field({ key: "upper_inner_shims_rf", displayLabel: "Upper inner shims RF", sortOrder: 4 }),
    field({ key: "upper_inner_shims_rr", displayLabel: "Upper inner shims RR", sortOrder: 5 }),
    field({ key: "driver", displayLabel: "Driver", sortOrder: 6, valueType: "string" }),
  ];
  const rows = inferSectionLayoutRows(fields);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.type, "pair");
  assert.equal(rows[1]?.type, "corner4");
  assert.equal(rows[2]?.type, "single");
});
