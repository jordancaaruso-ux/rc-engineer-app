/**
 * Run: `npx tsx src/lib/setupSheetModels/layoutGroupOps.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignFieldsToManualLayoutGroup,
  inferLayoutGroupRoleFromField,
  rebuildSectionLayout,
  ungroupLayoutGroup,
} from "@/lib/setupSheetModels/layoutGroupOps";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

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

test("infers front/rear from display labels without key suffixes", () => {
  const front = field({ key: "clip_o_ring_f", displayLabel: "clip / o-ring - front", sortOrder: 0 });
  const rear = field({ key: "clip_o_ring_r", displayLabel: "clip / o-ring - rear", sortOrder: 1 });
  assert.equal(inferLayoutGroupRoleFromField(front), "front");
  assert.equal(inferLayoutGroupRoleFromField(rear), "rear");
});

test("manual pair group creates layout row and survives section rebuild", () => {
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "Mugen",
    fields: [
      field({ key: "active_fixed_f", displayLabel: "Active / Fixed - Front", sortOrder: 0 }),
      field({ key: "active_fixed_r", displayLabel: "Active / Fixed - Rear", sortOrder: 1 }),
    ],
    structuredSections: [],
  };

  const grouped = assignFieldsToManualLayoutGroup(
    schema,
    ["active_fixed_f", "active_fixed_r"],
    "pair"
  );
  assert.ok(!("error" in grouped));
  if ("error" in grouped) return;

  const groupId = grouped.fields.find((f) => f.layoutGroupId)?.layoutGroupId;
  assert.ok(groupId);
  assert.equal(grouped.layoutGroups?.[groupId!]?.label, "Active / Fixed");

  const sec = grouped.structuredSections.find((s) => s.id === "suspension");
  assert.equal(sec?.rows.length, 1);
  assert.equal(sec?.rows[0]?.type, "pair");
  if (sec?.rows[0]?.type === "pair") {
    assert.equal(sec.rows[0].leftKey, "active_fixed_f");
    assert.equal(sec.rows[0].rightKey, "active_fixed_r");
    assert.equal(sec.rows[0].layoutGroupId, groupId);
  }

  const rebuilt = rebuildSectionLayout(
    grouped.structuredSections,
    "suspension",
    "Suspension",
    [
      ...grouped.fields,
      field({ key: "notes", displayLabel: "Notes", sortOrder: 2, uiType: "textarea", valueType: "string" }),
    ],
    grouped.layoutGroups
  );
  const rebuiltSec = rebuilt.find((s) => s.id === "suspension");
  assert.equal(rebuiltSec?.rows.filter((r) => r.type === "pair").length, 1);
  assert.equal(rebuiltSec?.rows.some((r) => r.type === "single" && r.key === "notes"), true);
});

test("ungroup restores single rows", () => {
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "Test",
    fields: [
      field({ key: "shim_ff", displayLabel: "Shim FF", sortOrder: 0 }),
      field({ key: "shim_fr", displayLabel: "Shim FR", sortOrder: 1 }),
      field({ key: "shim_rf", displayLabel: "Shim RF", sortOrder: 2 }),
      field({ key: "shim_rr", displayLabel: "Shim RR", sortOrder: 3 }),
    ],
    structuredSections: [],
  };
  const grouped = assignFieldsToManualLayoutGroup(
    schema,
    ["shim_ff", "shim_fr", "shim_rf", "shim_rr"],
    "corner4"
  );
  assert.ok(!("error" in grouped));
  if ("error" in grouped) return;
  const groupId = grouped.fields[0]?.layoutGroupId;
  assert.ok(groupId);

  const ungrouped = ungroupLayoutGroup(grouped, groupId!);
  assert.ok(!("error" in ungrouped));
  if ("error" in ungrouped) return;
  assert.equal(ungrouped.layoutGroups, undefined);
  assert.equal(ungrouped.fields.every((f) => !f.layoutGroupId), true);
  const sec = ungrouped.structuredSections.find((s) => s.id === "suspension");
  assert.equal(sec?.rows.length, 4);
  assert.equal(sec?.rows.every((r) => r.type === "single"), true);
});
