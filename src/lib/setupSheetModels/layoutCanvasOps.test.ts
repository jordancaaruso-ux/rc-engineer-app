/**
 * Run: `npx tsx --test src/lib/setupSheetModels/layoutCanvasOps.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addSection,
  adoptRowAsSlotsGroup,
  appendFieldToGroup,
  assignFieldToSlot,
  autoGroupPlacedSingles,
  autoPlaceOnArrival,
  deleteSection,
  makeSlotsGroup,
  moveFieldToSection,
  moveRow,
  moveSection,
  normalizeGroupsForEditing,
  placeMissingParameters,
  removeRowToTray,
  removeSlot,
  renameSection,
  resequenceSortOrderFromLayout,
  setSlotLabel,
  unplacedFields,
} from "@/lib/setupSheetModels/layoutCanvasOps";
import { modelLayoutToStructuredSections } from "@/lib/setupSheetModels/types";
import { buildA800SeedSchema } from "@/lib/setupSheetModels/seedA800Model";
import type {
  SetupSheetModelFieldDef,
  SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";

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

/** Four shims with no front/rear/corner naming — the shape the legacy path rejects outright. */
function shimSchema(): SetupSheetModelSchema {
  const fields = [
    field({ key: "lower_arm_shim_a", displayLabel: "Lower arm shim — Inner", sortOrder: 0 }),
    field({ key: "lower_arm_shim_b", displayLabel: "Lower arm shim — Outer", sortOrder: 1 }),
    field({ key: "lower_arm_shim_c", displayLabel: "Lower arm shim — Top", sortOrder: 2 }),
    field({ key: "lower_arm_shim_d", displayLabel: "Lower arm shim — Bottom", sortOrder: 3 }),
    field({ key: "spool", displayLabel: "Front spool", sectionId: "drivetrain", sectionTitle: "Drivetrain", sortOrder: 4 }),
  ];
  return {
    version: 1,
    label: "Test",
    fields,
    structuredSections: [
      {
        id: "suspension",
        title: "Suspension",
        rows: fields
          .filter((f) => f.sectionId === "suspension")
          .map((f) => ({ type: "single" as const, key: f.key, label: f.displayLabel })),
      },
      {
        id: "drivetrain",
        title: "Drivetrain",
        rows: [{ type: "single", key: "spool", label: "Front spool" }],
      },
    ],
  };
}

function ok(result: SetupSheetModelSchema | { error: string }): SetupSheetModelSchema {
  assert.ok(!("error" in result), "error" in result ? result.error : "");
  return result as SetupSheetModelSchema;
}

function rowsOf(schema: SetupSheetModelSchema, sectionId: string) {
  return schema.structuredSections.find((s) => s.id === sectionId)?.rows ?? [];
}

test("groups 4 parameters with no front/rear/corner naming", () => {
  const schema = shimSchema();
  const grouped = ok(
    makeSlotsGroup(schema, [
      "lower_arm_shim_a",
      "lower_arm_shim_b",
      "lower_arm_shim_c",
      "lower_arm_shim_d",
    ])
  );

  const rows = rowsOf(grouped, "suspension");
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.type, "slots");
  if (row.type !== "slots") return;
  assert.equal(row.slots.length, 4);
  // Slot labels come from the trailing qualifier of each display label.
  assert.deepEqual(row.slots.map((s) => s.label), ["Inner", "Outer", "Top", "Bottom"]);
  assert.equal(row.label, "Lower arm shim");

  const groupId = row.layoutGroupId!;
  assert.equal(grouped.layoutGroups?.[groupId]?.kind, "slots");
  assert.deepEqual(
    grouped.fields.filter((f) => f.layoutGroupId === groupId).map((f) => f.layoutSlotIndex),
    [0, 1, 2, 3]
  );
});

test("group row lands where the first member sat, not at the top of the section", () => {
  const schema = shimSchema();
  const grouped = ok(makeSlotsGroup(schema, ["lower_arm_shim_c", "lower_arm_shim_d"]));
  const rows = rowsOf(grouped, "suspension");
  // a, b stay as singles above; the pair takes slot 2 where "c" was.
  assert.deepEqual(rows.map((r) => r.type), ["single", "single", "slots"]);
});

test("rejects fewer than 2 or more than 6 members", () => {
  const schema = shimSchema();
  assert.ok("error" in makeSlotsGroup(schema, ["lower_arm_shim_a"]));
  assert.ok(
    "error" in
      makeSlotsGroup(schema, [
        "a1", "a2", "a3", "a4", "a5", "a6", "a7",
      ])
  );
});

test("dropping onto an occupied slot evicts the incumbent to its own row", () => {
  const schema = shimSchema();
  const grouped = ok(makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b"]));
  const rowIndex = rowsOf(grouped, "suspension").findIndex((r) => r.type === "slots");

  const after = ok(assignFieldToSlot(grouped, "suspension", rowIndex, 1, "lower_arm_shim_c"));
  const rows = rowsOf(after, "suspension");
  const row = rows[rowIndex]!;
  assert.equal(row.type, "slots");
  if (row.type !== "slots") return;
  assert.deepEqual(row.slots.map((s) => s.key), ["lower_arm_shim_a", "lower_arm_shim_c"]);

  // The evicted parameter is still on the sheet, directly below.
  const evicted = rows[rowIndex + 1]!;
  assert.equal(evicted.type, "single");
  if (evicted.type === "single") assert.equal(evicted.key, "lower_arm_shim_b");
  assert.equal(after.fields.find((f) => f.key === "lower_arm_shim_b")?.layoutGroupId, undefined);
  assert.equal(unplacedFields(after).length, 0);
});

test("swapping two members of the same group keeps both in the row", () => {
  const schema = shimSchema();
  const grouped = ok(
    makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b", "lower_arm_shim_c"])
  );
  const rowIndex = rowsOf(grouped, "suspension").findIndex((r) => r.type === "slots");
  const after = ok(assignFieldToSlot(grouped, "suspension", rowIndex, 0, "lower_arm_shim_c"));
  const row = rowsOf(after, "suspension")[rowIndex]!;
  if (row.type !== "slots") return assert.fail("expected slots row");
  assert.deepEqual(row.slots.map((s) => s.key), [
    "lower_arm_shim_c",
    "lower_arm_shim_b",
    "lower_arm_shim_a",
  ]);
  assert.equal(unplacedFields(after).length, 0);
});

test("removing a slot from a 2-slot row collapses the group", () => {
  const schema = shimSchema();
  const grouped = ok(makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b"]));
  const rowIndex = rowsOf(grouped, "suspension").findIndex((r) => r.type === "slots");

  const after = ok(removeSlot(grouped, "suspension", rowIndex, 0));
  const rows = rowsOf(after, "suspension");
  assert.ok(rows.every((r) => r.type === "single"));
  assert.equal(after.layoutGroups, undefined);
  assert.equal(unplacedFields(after).length, 0);
});

test("removing a slot from a 3-slot row shifts the remaining slot indexes down", () => {
  const schema = shimSchema();
  const grouped = ok(
    makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b", "lower_arm_shim_c"])
  );
  const rowIndex = rowsOf(grouped, "suspension").findIndex((r) => r.type === "slots");
  const after = ok(removeSlot(grouped, "suspension", rowIndex, 0));

  const row = rowsOf(after, "suspension")[rowIndex]!;
  if (row.type !== "slots") return assert.fail("expected slots row");
  assert.deepEqual(row.slots.map((s) => s.key), ["lower_arm_shim_b", "lower_arm_shim_c"]);
  assert.equal(after.fields.find((f) => f.key === "lower_arm_shim_b")?.layoutSlotIndex, 0);
  assert.equal(after.fields.find((f) => f.key === "lower_arm_shim_c")?.layoutSlotIndex, 1);
  assert.equal(unplacedFields(after).length, 0);
});

test("appending grows a group up to 6 and then refuses", () => {
  const schema = shimSchema();
  let next = ok(makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b"]));
  const rowIndex = rowsOf(next, "suspension").findIndex((r) => r.type === "slots");
  next = ok(appendFieldToGroup(next, "suspension", rowIndex, "lower_arm_shim_c"));

  const row = rowsOf(next, "suspension")[rowIndex]!;
  if (row.type !== "slots") return assert.fail("expected slots row");
  assert.equal(row.slots.length, 3);
  assert.equal(next.fields.find((f) => f.key === "lower_arm_shim_c")?.layoutSlotIndex, 2);
});

test("moving a parameter to another section rewrites its sectionId", () => {
  const schema = shimSchema();
  const after = ok(moveFieldToSection(schema, "lower_arm_shim_a", "drivetrain"));

  assert.equal(after.fields.find((f) => f.key === "lower_arm_shim_a")?.sectionId, "drivetrain");
  assert.equal(after.fields.find((f) => f.key === "lower_arm_shim_a")?.sectionTitle, "Drivetrain");
  assert.equal(rowsOf(after, "suspension").length, 3);
  assert.equal(rowsOf(after, "drivetrain").length, 2);
  assert.equal(unplacedFields(after).length, 0);
});

test("moving a grouped parameter out of its group detaches it cleanly", () => {
  const schema = shimSchema();
  const grouped = ok(
    makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b", "lower_arm_shim_c"])
  );
  const after = ok(moveFieldToSection(grouped, "lower_arm_shim_b", "drivetrain"));

  const row = rowsOf(after, "suspension").find((r) => r.type === "slots");
  if (!row || row.type !== "slots") return assert.fail("expected slots row");
  assert.deepEqual(row.slots.map((s) => s.key), ["lower_arm_shim_a", "lower_arm_shim_c"]);
  assert.equal(after.fields.find((f) => f.key === "lower_arm_shim_b")?.sectionId, "drivetrain");
  assert.equal(after.fields.find((f) => f.key === "lower_arm_shim_b")?.layoutGroupId, undefined);
  assert.equal(unplacedFields(after).length, 0);
});

test("moving a group row across sections carries its members' sectionId", () => {
  const schema = shimSchema();
  const grouped = ok(makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b"]));
  const rowIndex = rowsOf(grouped, "suspension").findIndex((r) => r.type === "slots");
  const after = ok(moveRow(grouped, "suspension", rowIndex, "drivetrain", 0));

  assert.equal(rowsOf(after, "drivetrain")[0]?.type, "slots");
  for (const key of ["lower_arm_shim_a", "lower_arm_shim_b"]) {
    assert.equal(after.fields.find((f) => f.key === key)?.sectionId, "drivetrain");
  }
  const groupId = Object.keys(after.layoutGroups ?? {})[0]!;
  assert.equal(after.layoutGroups?.[groupId]?.sectionId, "drivetrain");
});

test("reordering a row within one section keeps every parameter placed", () => {
  const schema = shimSchema();
  const after = ok(moveRow(schema, "suspension", 0, "suspension", 3));
  assert.deepEqual(
    rowsOf(after, "suspension").map((r) => (r.type === "single" ? r.key : "?")),
    ["lower_arm_shim_b", "lower_arm_shim_c", "lower_arm_shim_a", "lower_arm_shim_d"]
  );
  assert.equal(unplacedFields(after).length, 0);
});

test("slot labels are editable and reach the rendered row", () => {
  const schema = shimSchema();
  const grouped = ok(makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b"]));
  const rowIndex = rowsOf(grouped, "suspension").findIndex((r) => r.type === "slots");
  const after = ok(setSlotLabel(grouped, "suspension", rowIndex, 0, "  Left  "));

  const row = rowsOf(after, "suspension")[rowIndex]!;
  if (row.type !== "slots") return assert.fail("expected slots row");
  assert.equal(row.slots[0]!.label, "Left");
  const groupId = row.layoutGroupId!;
  assert.equal(after.layoutGroups?.[groupId]?.slotLabels?.[0], "Left");
});

test("deleting a section moves its parameters to Other, never deletes them", () => {
  const schema = shimSchema();
  const after = ok(deleteSection(schema, "drivetrain"));

  assert.equal(after.structuredSections.some((s) => s.id === "drivetrain"), false);
  assert.equal(after.fields.length, schema.fields.length);
  assert.equal(after.fields.find((f) => f.key === "spool")?.sectionId, "other");
  assert.equal(after.fields.find((f) => f.key === "spool")?.sectionTitle, "Other");
  assert.equal(unplacedFields(after).length, 0);
});

test("adding a section derives a unique id from the title", () => {
  const schema = shimSchema();
  const once = ok(addSection(schema, "Shock towers"));
  const twice = ok(addSection(once, "Shock towers"));
  const ids = twice.structuredSections.map((s) => s.id);
  assert.ok(ids.includes("shock_towers"));
  assert.ok(ids.includes("shock_towers_1"));
});

test("placeMissingParameters leaves hand-made rows byte-identical", () => {
  const schema = shimSchema();
  const grouped = ok(makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b"]));
  const withOrphan: SetupSheetModelSchema = {
    ...grouped,
    fields: [
      ...grouped.fields,
      field({ key: "camber_front", displayLabel: "Camber — Front", sortOrder: 9 }),
    ],
  };
  assert.equal(unplacedFields(withOrphan).length, 1);

  const before = JSON.stringify(rowsOf(withOrphan, "suspension"));
  const after = placeMissingParameters(withOrphan);
  const rows = rowsOf(after, "suspension");

  assert.equal(JSON.stringify(rows.slice(0, rowsOf(withOrphan, "suspension").length)), before);
  assert.equal(unplacedFields(after).length, 0);
});

test("removeRowToTray sends a single row's parameter back to the tray", () => {
  const schema = shimSchema();
  const after = ok(removeRowToTray(schema, "suspension", 0));
  // The row is gone but the field def remains, now unplaced.
  assert.equal(rowsOf(after, "suspension").length, 3);
  assert.equal(after.fields.length, schema.fields.length);
  const tray = unplacedFields(after).map((f) => f.key);
  assert.deepEqual(tray, ["lower_arm_shim_a"]);
});

test("removeRowToTray on a group frees every member and drops the group record", () => {
  const schema = shimSchema();
  const grouped = ok(
    makeSlotsGroup(schema, ["lower_arm_shim_a", "lower_arm_shim_b", "lower_arm_shim_c"])
  );
  const rowIndex = rowsOf(grouped, "suspension").findIndex((r) => r.type === "slots");
  const after = ok(removeRowToTray(grouped, "suspension", rowIndex));

  assert.equal(after.layoutGroups, undefined);
  const tray = unplacedFields(after).map((f) => f.key).sort();
  assert.deepEqual(tray, ["lower_arm_shim_a", "lower_arm_shim_b", "lower_arm_shim_c"]);
  for (const key of ["lower_arm_shim_a", "lower_arm_shim_b", "lower_arm_shim_c"]) {
    assert.equal(after.fields.find((f) => f.key === key)?.layoutGroupId, undefined);
  }
});

test("removeRowToTray keeps an emptied section as a drop target", () => {
  const schema = shimSchema();
  const after = ok(removeRowToTray(schema, "drivetrain", 0));
  assert.ok(after.structuredSections.some((s) => s.id === "drivetrain"));
  assert.equal(rowsOf(after, "drivetrain").length, 0);
  assert.deepEqual(unplacedFields(after).map((f) => f.key), ["spool"]);
});

test("moveSection reorders sections and rejects bad indexes", () => {
  const schema = shimSchema();
  const after = ok(moveSection(schema, 0, 1));
  assert.deepEqual(after.structuredSections.map((s) => s.id), ["drivetrain", "suspension"]);
  assert.ok("error" in moveSection(schema, 0, 5));
});

test("renameSection updates the title on the section and its field defs", () => {
  const schema = shimSchema();
  const after = ok(renameSection(schema, "suspension", "  Front suspension  "));
  assert.equal(after.structuredSections.find((s) => s.id === "suspension")?.title, "Front suspension");
  const susp = after.fields.filter((f) => f.sectionId === "suspension");
  assert.ok(susp.length > 0);
  assert.ok(susp.every((f) => f.sectionTitle === "Front suspension"));
  assert.ok("error" in renameSection(schema, "suspension", "   "));
});

test("A800 seed schema round-trips through the editor unchanged", () => {
  const seed = buildA800SeedSchema();
  const normalized = normalizeGroupsForEditing(seed);
  // Inferred pair/corner4 rows carry no group record, so nothing is adopted on load.
  assert.deepEqual(normalized.structuredSections, seed.structuredSections);
  assert.deepEqual(
    modelLayoutToStructuredSections(normalized),
    modelLayoutToStructuredSections(seed)
  );
});

test("adopting a corner4 row keeps it rendering as corner4", () => {
  const fields = ["ff", "fr", "rf", "rr"].map((c, i) =>
    field({ key: `upper_inner_shims_${c}`, displayLabel: `Upper inner shims ${c.toUpperCase()}`, sortOrder: i })
  );
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "Test",
    fields,
    structuredSections: [
      {
        id: "suspension",
        title: "Suspension",
        rows: [
          {
            type: "corner4",
            label: "Upper inner shims",
            ff: "upper_inner_shims_ff",
            fr: "upper_inner_shims_fr",
            rf: "upper_inner_shims_rf",
            rr: "upper_inner_shims_rr",
          },
        ],
      },
    ],
  };

  const adopted = ok(adoptRowAsSlotsGroup(schema, "suspension", 0));
  assert.equal(rowsOf(adopted, "suspension")[0]?.type, "slots");

  // The display boundary maps the classic FF/FR/RF/RR shape back to corner4 — sheets don't change.
  const display = modelLayoutToStructuredSections(adopted);
  assert.equal(display[0]?.rows[0]?.type, "corner4");
  assert.deepEqual(display, modelLayoutToStructuredSections(schema));
});

test("a relabelled corner row renders as a flat slots row", () => {
  const fields = ["ff", "fr", "rf", "rr"].map((c, i) =>
    field({ key: `shim_${c}`, displayLabel: `Shim ${c.toUpperCase()}`, sortOrder: i })
  );
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "Test",
    fields,
    structuredSections: [
      {
        id: "suspension",
        title: "Suspension",
        rows: [
          { type: "corner4", label: "Shims", ff: "shim_ff", fr: "shim_fr", rf: "shim_rf", rr: "shim_rr" },
        ],
      },
    ],
  };

  const relabelled = ok(setSlotLabel(schema, "suspension", 0, 0, "Inner"));
  const display = modelLayoutToStructuredSections(relabelled);
  assert.equal(display[0]?.rows[0]?.type, "slots");
  const row = display[0]!.rows[0]!;
  if (row.type !== "slots") return assert.fail("expected slots row");
  assert.deepEqual(row.slots.map((s) => s.label), ["Inner", "FR", "RF", "RR"]);
});

/* ---------- arrival placement + one-order-everywhere (2026-07-25) ---------- */

/** What a box-first calibration hands over: fields exist, the canvas is untouched. */
function fromCalibration(): SetupSheetModelSchema {
  return {
    version: 1,
    label: "Test",
    fields: [
      field({ key: "camber_front", displayLabel: "Camber (Front)", sortOrder: 0 }),
      field({ key: "camber_rear", displayLabel: "Camber (Rear)", sortOrder: 1 }),
      field({ key: "total_weight", displayLabel: "Total weight", sortOrder: 2 }),
    ],
    structuredSections: [],
  };
}

test("arriving from a calibration places everything and pairs the front/rear set", () => {
  const res = autoPlaceOnArrival(fromCalibration());
  assert.equal(res.placedCount, 3);
  assert.equal(unplacedFields(res.schema).length, 0);
  const rows = res.schema.structuredSections.flatMap((s) => s.rows);
  // Camber (Front) + Camber (Rear) become one row, not two singles.
  assert.ok(rows.some((r) => r.type !== "single"), "expected a grouped row for the front/rear pair");
  assert.ok(rows.some((r) => r.type === "single"), "expected total_weight to stay a single");
});

test("a canvas that already has rows is never reshuffled on arrival", () => {
  const placed = autoPlaceOnArrival(fromCalibration()).schema;
  const withExtra = { ...placed, fields: [...placed.fields, field({ key: "toe_front", displayLabel: "Toe (Front)" })] };
  const second = autoPlaceOnArrival(withExtra);
  assert.equal(second.placedCount, 0);
  assert.equal(second.schema, withExtra, "expected the schema to come back untouched");
  // The new one stays in the tray for the explicit "Place all" button.
  assert.deepEqual(unplacedFields(second.schema).map((f) => f.key), ["toe_front"]);
});

test("an empty sheet with nothing to place is left alone", () => {
  const empty: SetupSheetModelSchema = { version: 1, label: "T", fields: [], structuredSections: [] };
  assert.equal(autoPlaceOnArrival(empty).placedCount, 0);
});

test("sortOrder is renumbered to the canvas order, so Log run follows the arrangement", () => {
  const placed = autoPlaceOnArrival(fromCalibration()).schema;
  const secId = placed.structuredSections[0]!.id;
  const lastIdx = placed.structuredSections[0]!.rows.length - 1;
  // Drag the last row to the top, the way ordering by importance works.
  const moved = moveRow(placed, secId, lastIdx, secId, 0);
  assert.ok(!("error" in moved));
  if ("error" in moved) return;

  const before = new Map(moved.fields.map((f) => [f.key, f.sortOrder]));
  const after = resequenceSortOrderFromLayout(moved);
  const orderNow = [...after.fields].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.key);
  const canvasOrder = after.structuredSections.flatMap((s) =>
    s.rows.flatMap((r) => (r.type === "single" ? [r.key] : []))
  );
  // Every placed key appears in sortOrder in the same relative order as on the canvas.
  const placedInSortOrder = orderNow.filter((k) => canvasOrder.includes(k));
  assert.deepEqual(placedInSortOrder, canvasOrder);
  assert.notDeepEqual([...after.fields.map((f) => f.sortOrder)], [...before.values()]);
});

test("unplaced parameters sort after the sheet and keep their relative order", () => {
  const base = autoPlaceOnArrival(fromCalibration()).schema;
  const withTray = {
    ...base,
    fields: [
      ...base.fields,
      field({ key: "zzz_note", displayLabel: "Note", sortOrder: 98 }),
      field({ key: "aaa_note", displayLabel: "Other note", sortOrder: 99 }),
    ],
  };
  const after = resequenceSortOrderFromLayout(withTray);
  const placedKeys = new Set(base.fields.map((f) => f.key));
  const maxPlaced = Math.max(...after.fields.filter((f) => placedKeys.has(f.key)).map((f) => f.sortOrder));
  const tray = after.fields.filter((f) => !placedKeys.has(f.key)).sort((a, b) => a.sortOrder - b.sortOrder);
  assert.ok(tray.every((f) => f.sortOrder > maxPlaced), "tray must sort after everything on the sheet");
  assert.deepEqual(tray.map((f) => f.key), ["zzz_note", "aaa_note"], "relative order preserved");
});

test("resequencing an already-correct schema returns it unchanged", () => {
  const once = resequenceSortOrderFromLayout(autoPlaceOnArrival(fromCalibration()).schema);
  assert.equal(resequenceSortOrderFromLayout(once), once);
});

/* ---------- auto-grouping rows already on the sheet (2026-07-30) ---------- */

/**
 * What one-at-a-time parameter creation leaves behind: a complete front/rear set, a complete corner
 * set, a half set, and a loner — all placed as separate single rows, so the tray is empty and
 * `placeMissingParameters` has nothing to work on.
 */
function placedAsSingles(): SetupSheetModelSchema {
  const fields = [
    field({ key: "camber_front", displayLabel: "Camber (Front)", sortOrder: 0 }),
    field({ key: "camber_rear", displayLabel: "Camber (Rear)", sortOrder: 1 }),
    field({ key: "total_weight", displayLabel: "Total weight", sortOrder: 2 }),
    field({ key: "droop_ff", displayLabel: "Droop — FF", sortOrder: 3 }),
    field({ key: "droop_fr", displayLabel: "Droop — FR", sortOrder: 4 }),
    field({ key: "droop_rf", displayLabel: "Droop — RF", sortOrder: 5 }),
    field({ key: "droop_rr", displayLabel: "Droop — RR", sortOrder: 6 }),
    field({ key: "toe_front", displayLabel: "Toe (Front)", sortOrder: 7 }),
  ];
  return {
    version: 1,
    label: "Test",
    fields,
    structuredSections: [
      {
        id: "suspension",
        title: "Suspension",
        rows: fields.map((f) => ({ type: "single" as const, key: f.key, label: f.displayLabel })),
      },
    ],
  };
}

test("auto-group merges the complete front/rear and corner sets already on the sheet", () => {
  const res = autoGroupPlacedSingles(placedAsSingles());
  assert.equal(res.groupedCount, 2);

  const rows = rowsOf(res.schema, "suspension");
  // camber pair · total weight · droop corners · toe front — 8 singles became 4 rows.
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.type),
    ["slots", "single", "slots", "single"]
  );

  const camber = rows[0]!;
  if (camber.type !== "slots") return assert.fail("expected a slots row for the camber pair");
  assert.deepEqual(camber.slots.map((s) => s.key), ["camber_front", "camber_rear"]);
  assert.deepEqual(camber.slots.map((s) => s.label), ["Front", "Rear"]);
  assert.equal(camber.label, "Camber");

  const droop = rows[2]!;
  if (droop.type !== "slots") return assert.fail("expected a slots row for the droop corners");
  assert.deepEqual(droop.slots.map((s) => s.key), ["droop_ff", "droop_fr", "droop_rf", "droop_rr"]);
  assert.deepEqual(droop.slots.map((s) => s.label), ["FF", "FR", "RF", "RR"]);
  assert.equal(droop.label, "Droop");
});

test("a half set is left alone — grouping needs every location", () => {
  const rows = rowsOf(autoGroupPlacedSingles(placedAsSingles()).schema, "suspension");
  const toe = rows.find((r) => r.type === "single" && r.key === "toe_front");
  assert.ok(toe, "toe_front has no rear partner, so it must stay a single row");
});

test("auto-group never touches a row the user arranged by hand", () => {
  // Drag the loner to the top, the way ordering by importance works.
  const moved = ok(moveRow(placedAsSingles(), "suspension", 2, "suspension", 0));
  const res = autoGroupPlacedSingles(moved);
  assert.equal(res.groupedCount, 2);

  const rows = rowsOf(res.schema, "suspension");
  const first = rows[0]!;
  assert.equal(first.type, "single");
  if (first.type !== "single") return;
  assert.equal(first.key, "total_weight", "the hand-placed row must still be first");
});

test("auto-group is idempotent and reports nothing left to do", () => {
  const once = autoGroupPlacedSingles(placedAsSingles()).schema;
  const twice = autoGroupPlacedSingles(once);
  assert.equal(twice.groupedCount, 0);
  assert.equal(twice.schema, once, "expected the schema to come back untouched");
});

test("auto-group leaves an existing manual group intact", () => {
  const grouped = ok(makeSlotsGroup(placedAsSingles(), ["camber_front", "total_weight"]));
  const res = autoGroupPlacedSingles(grouped);
  // Only the droop corners are still loose; camber is spoken for by the manual group.
  assert.equal(res.groupedCount, 1);
  const keys = rowsOf(res.schema, "suspension").flatMap((r) =>
    r.type === "slots" ? r.slots.map((s) => s.key) : []
  );
  assert.ok(keys.includes("camber_front") && keys.includes("total_weight"));
  assert.ok(!rowsOf(res.schema, "suspension").some((r) => r.type === "single" && r.key === "camber_front"));
});
