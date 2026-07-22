/**
 * Pure mutations for the setup-sheet schema canvas: move a parameter into any section, group 2–6
 * parameters into a free-labelled row, edit slots, manage sections.
 *
 * These edit `structuredSections` **in place** rather than re-deriving them via
 * `syncLayoutSectionsForGroups`. That's deliberate: a full re-sync floats every manual group row to
 * the top of its section, which throws away the order the user just dragged into place.
 */
import { inferSectionLayoutRows } from "@/lib/setupSheetModels/inferStructuredLayout";
import { collectModelLayoutKeys } from "@/lib/setupSheetModels/filterStructuredLayoutByKeys";
import { createLayoutGroupId, inferLayoutGroupLabel } from "@/lib/setupSheetModels/layoutGroupOps";
import {
  MAX_LAYOUT_SLOTS,
  MIN_LAYOUT_SLOTS,
  type SetupSheetLayoutGroup,
  type SetupSheetModelFieldDef,
  type SetupSheetModelLayoutRow,
  type SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";

export type OpResult = SetupSheetModelSchema | { error: string };

const FALLBACK_SECTION_ID = "other";
const FALLBACK_SECTION_TITLE = "Other";
const DEFAULT_CORNER_SLOT_LABELS = ["FF", "FR", "RF", "RR", "5", "6"];
const DEFAULT_PAIR_SLOT_LABELS = ["Front", "Rear"];

/* ------------------------------------------------------------------ shared */

function groups(schema: SetupSheetModelSchema): Record<string, SetupSheetLayoutGroup> {
  return schema.layoutGroups ?? {};
}

function withGroups(
  schema: SetupSheetModelSchema,
  next: Record<string, SetupSheetLayoutGroup>
): SetupSheetModelSchema {
  return { ...schema, layoutGroups: Object.keys(next).length > 0 ? next : undefined };
}

export function layoutRowKeys(row: SetupSheetModelLayoutRow): string[] {
  if (row.type === "single") return [row.key];
  if (row.type === "pair") return [row.leftKey, row.rightKey];
  if (row.type === "corner4") return [row.ff, row.fr, row.rf, row.rr];
  if (row.type === "slots") return row.slots.map((s) => s.key);
  return [];
}

export function rowGroupId(row: SetupSheetModelLayoutRow): string | undefined {
  if (row.type === "pair" || row.type === "corner4" || row.type === "slots") return row.layoutGroupId;
  return undefined;
}

function singleRowFor(field: SetupSheetModelFieldDef): SetupSheetModelLayoutRow {
  return {
    type: "single",
    key: field.key,
    label: field.displayLabel,
    unit: field.unit,
    multiline: field.uiType === "textarea",
  };
}

/** Locate a field's row (and slot, when it sits in a group). */
export function locateField(
  schema: SetupSheetModelSchema,
  key: string
): { sectionId: string; rowIndex: number; slotIndex: number } | null {
  for (const sec of schema.structuredSections) {
    for (let i = 0; i < sec.rows.length; i++) {
      const keys = layoutRowKeys(sec.rows[i]!);
      const slot = keys.indexOf(key);
      if (slot >= 0) {
        return { sectionId: sec.id, rowIndex: i, slotIndex: sec.rows[i]!.type === "single" ? -1 : slot };
      }
    }
  }
  return null;
}

function mapSection(
  schema: SetupSheetModelSchema,
  sectionId: string,
  fn: (rows: SetupSheetModelLayoutRow[]) => SetupSheetModelLayoutRow[]
): SetupSheetModelSchema {
  return {
    ...schema,
    structuredSections: schema.structuredSections.map((sec) =>
      sec.id === sectionId ? { ...sec, rows: fn([...sec.rows]) } : sec
    ),
  };
}

function patchField(
  schema: SetupSheetModelSchema,
  key: string,
  patch: Partial<SetupSheetModelFieldDef>
): SetupSheetModelSchema {
  return {
    ...schema,
    fields: schema.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
  };
}

function ensureSection(
  schema: SetupSheetModelSchema,
  id: string,
  title: string
): SetupSheetModelSchema {
  if (schema.structuredSections.some((s) => s.id === id)) return schema;
  return {
    ...schema,
    structuredSections: [...schema.structuredSections, { id, title, rows: [] }],
  };
}

function sectionTitleFor(schema: SetupSheetModelSchema, id: string): string {
  const sec = schema.structuredSections.find((s) => s.id === id);
  if (sec) return sec.title;
  const field = schema.fields.find((f) => f.sectionId === id);
  return field?.sectionTitle ?? id;
}

/**
 * Pull a field out of whatever row holds it, leaving the rest of the layout valid.
 * A group that drops below two filled slots collapses back to single rows.
 */
function detachField(schema: SetupSheetModelSchema, key: string): SetupSheetModelSchema {
  const at = locateField(schema, key);
  if (!at) return schema;
  const sec = schema.structuredSections.find((s) => s.id === at.sectionId)!;
  const row = sec.rows[at.rowIndex]!;

  let next = patchField(schema, key, {
    layoutGroupId: undefined,
    layoutGroupRole: undefined,
    layoutSlotIndex: undefined,
  });

  if (row.type === "single") {
    return mapSection(next, at.sectionId, (rows) => {
      rows.splice(at.rowIndex, 1);
      return rows;
    });
  }

  // Grouped: adopt to slots first so removal is expressible, then drop the slot.
  const adopted = adoptRowAsSlotsGroup(next, at.sectionId, at.rowIndex);
  if ("error" in adopted) return next;
  next = adopted;

  const adoptedRow = next.structuredSections.find((s) => s.id === at.sectionId)!.rows[at.rowIndex]!;
  const groupId = rowGroupId(adoptedRow);
  if (!groupId || adoptedRow.type !== "slots") return next;

  next = patchField(next, key, {
    layoutGroupId: undefined,
    layoutGroupRole: undefined,
    layoutSlotIndex: undefined,
  });
  return removeSlotByKey(next, at.sectionId, at.rowIndex, groupId, key);
}

/** Drop one member from a slots row; collapse the whole group when fewer than 2 remain. */
function removeSlotByKey(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number,
  groupId: string,
  key: string
): SetupSheetModelSchema {
  const sec = schema.structuredSections.find((s) => s.id === sectionId)!;
  const row = sec.rows[rowIndex]!;
  if (row.type !== "slots") return schema;

  const keptSlots = row.slots.filter((s) => s.key !== key);

  if (keptSlots.length < MIN_LAYOUT_SLOTS) {
    // Collapse: survivors become single rows in place, group record disappears.
    const survivors = keptSlots
      .map((s) => schema.fields.find((f) => f.key === s.key))
      .filter((f): f is SetupSheetModelFieldDef => f != null);
    let next = schema;
    for (const f of survivors) {
      next = patchField(next, f.key, {
        layoutGroupId: undefined,
        layoutGroupRole: undefined,
        layoutSlotIndex: undefined,
      });
    }
    const nextGroups = { ...groups(next) };
    delete nextGroups[groupId];
    next = withGroups(next, nextGroups);
    return mapSection(next, sectionId, (rows) => {
      rows.splice(rowIndex, 1, ...survivors.map(singleRowFor));
      return rows;
    });
  }

  const group = groups(schema)[groupId];
  const removedIdx = row.slots.findIndex((s) => s.key === key);
  const nextLabels = (group?.slotLabels ?? row.slots.map((s) => s.label)).filter(
    (_, i) => i !== removedIdx
  );

  let next = schema;
  if (group) {
    next = withGroups(next, { ...groups(next), [groupId]: { ...group, slotLabels: nextLabels } });
  }
  // Slot indexes are positional — everything after the hole shifts down one.
  keptSlots.forEach((slot, i) => {
    next = patchField(next, slot.key, { layoutSlotIndex: i });
  });
  return mapSection(next, sectionId, (rows) => {
    rows[rowIndex] = { ...row, slots: keptSlots };
    return rows;
  });
}

/* --------------------------------------------------- legacy → slots adoption */

function legacyRowSlots(
  row: SetupSheetModelLayoutRow
): { label: string; key: string }[] | null {
  if (row.type === "slots") return row.slots;
  if (row.type === "pair") {
    return [
      { label: DEFAULT_PAIR_SLOT_LABELS[0]!, key: row.leftKey },
      { label: DEFAULT_PAIR_SLOT_LABELS[1]!, key: row.rightKey },
    ];
  }
  if (row.type === "corner4") {
    return [
      { label: "FF", key: row.ff },
      { label: "FR", key: row.fr },
      { label: "RF", key: row.rf },
      { label: "RR", key: row.rr },
    ];
  }
  return null;
}

/**
 * Convert one pair / corner4 row into a manual `slots` group.
 *
 * Called lazily — only when the user actually edits that row. Adopting every inferred row up front
 * would freeze each model to fully-manual on its first save and kill auto-inference for good.
 * Already-slots rows are returned untouched, so callers can adopt unconditionally.
 */
export function adoptRowAsSlotsGroup(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number
): OpResult {
  const sec = schema.structuredSections.find((s) => s.id === sectionId);
  if (!sec) return { error: "Section not found." };
  const row = sec.rows[rowIndex];
  if (!row) return { error: "Row not found." };
  if (row.type === "slots" && row.layoutGroupId && groups(schema)[row.layoutGroupId]) return schema;

  const slots = legacyRowSlots(row);
  if (!slots) return { error: "This row can't be grouped." };

  const members = slots
    .map((s) => schema.fields.find((f) => f.key === s.key))
    .filter((f): f is SetupSheetModelFieldDef => f != null);
  if (members.length !== slots.length) return { error: "One or more parameters were not found." };

  const existingGroupId = rowGroupId(row);
  const groupId = existingGroupId ?? createLayoutGroupId();
  const group: SetupSheetLayoutGroup = {
    id: groupId,
    kind: "slots",
    label: row.type === "top_deck_block" || row.type === "screw_strip" ? "" : row.label,
    manual: true,
    sectionId,
    slotLabels: slots.map((s) => s.label),
  };

  let next = withGroups(schema, { ...groups(schema), [groupId]: group });
  slots.forEach((slot, i) => {
    next = patchField(next, slot.key, {
      layoutGroupId: groupId,
      layoutGroupRole: undefined,
      layoutSlotIndex: i,
    });
  });
  return mapSection(next, sectionId, (rows) => {
    rows[rowIndex] = {
      type: "slots",
      label: group.label,
      unit: row.type === "pair" || row.type === "corner4" ? row.unit : undefined,
      slots,
      layoutGroupId: groupId,
    };
    return rows;
  });
}

/**
 * Editor-load normalisation: rewrite persisted `pair` / `corner4` **groups** (ones that already have
 * a layoutGroups record) into `slots`, so the canvas only ever deals with one shape. Inferred rows
 * with no group record are left alone — see {@link adoptRowAsSlotsGroup}.
 */
export function normalizeGroupsForEditing(schema: SetupSheetModelSchema): SetupSheetModelSchema {
  const legacy = Object.values(groups(schema)).filter((g) => g.kind !== "slots");
  if (legacy.length === 0) return schema;

  let next = schema;
  for (const group of legacy) {
    for (const sec of next.structuredSections) {
      const rowIndex = sec.rows.findIndex((r) => rowGroupId(r) === group.id);
      if (rowIndex < 0) continue;
      const adopted = adoptRowAsSlotsGroup(next, sec.id, rowIndex);
      if (!("error" in adopted)) next = adopted;
      break;
    }
  }
  return next;
}

/* ------------------------------------------------------------------ grouping */

function defaultSlotLabels(fields: SetupSheetModelFieldDef[]): string[] {
  // Prefer the trailing qualifier of each label ("Droop — Front" → "Front") when they're distinct.
  const suffixes = fields.map((f) => {
    const m = f.displayLabel.match(/[—–-]\s*([^—–-]+)$/);
    return m ? m[1]!.trim() : "";
  });
  if (suffixes.every(Boolean) && new Set(suffixes).size === suffixes.length) return suffixes;

  if (fields.length === 2) return [...DEFAULT_PAIR_SLOT_LABELS];
  return fields.map((_, i) => DEFAULT_CORNER_SLOT_LABELS[i] ?? String(i + 1));
}

/**
 * Group 2–6 parameters into one free-labelled row. Unlike the legacy pair/corner4 path this never
 * inspects key or label suffixes, so parameters with no Front/Rear/FF naming group fine.
 */
export function makeSlotsGroup(
  schema: SetupSheetModelSchema,
  fieldKeys: string[],
  opts?: { label?: string; slotLabels?: string[] }
): OpResult {
  const keys = [...new Set(fieldKeys.map((k) => k.trim()).filter(Boolean))];
  if (keys.length < MIN_LAYOUT_SLOTS || keys.length > MAX_LAYOUT_SLOTS) {
    return { error: `Select between ${MIN_LAYOUT_SLOTS} and ${MAX_LAYOUT_SLOTS} parameters to make a row.` };
  }

  const members = keys.map((k) => schema.fields.find((f) => f.key === k));
  if (members.some((f) => !f)) return { error: "One or more parameters were not found." };
  const fields = members as SetupSheetModelFieldDef[];

  // The row lands in the first selected parameter's section, at the highest position any of them held.
  const targetSectionId = fields[0]!.sectionId;
  const targetTitle = fields[0]!.sectionTitle;
  let insertAt = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const at = locateField(schema, key);
    if (at?.sectionId === targetSectionId) insertAt = Math.min(insertAt, at.rowIndex);
  }

  let next: SetupSheetModelSchema = ensureSection(schema, targetSectionId, targetTitle);
  for (const key of keys) next = detachField(next, key);

  const slotLabels =
    opts?.slotLabels && opts.slotLabels.length === keys.length
      ? opts.slotLabels.map((l) => l.trim())
      : defaultSlotLabels(fields);

  const groupId = createLayoutGroupId();
  const group: SetupSheetLayoutGroup = {
    id: groupId,
    kind: "slots",
    label: opts?.label?.trim() || groupLabelFor(fields),
    manual: true,
    sectionId: targetSectionId,
    slotLabels,
  };
  next = withGroups(next, { ...groups(next), [groupId]: group });

  keys.forEach((key, i) => {
    next = patchField(next, key, {
      sectionId: targetSectionId,
      sectionTitle: targetTitle,
      layoutGroupId: groupId,
      layoutGroupRole: undefined,
      layoutSlotIndex: i,
    });
  });

  const row: SetupSheetModelLayoutRow = {
    type: "slots",
    label: group.label,
    unit: sharedUnit(fields),
    slots: keys.map((key, i) => ({ label: slotLabels[i] ?? "", key })),
    layoutGroupId: groupId,
  };

  return mapSection(next, targetSectionId, (rows) => {
    const idx = Number.isFinite(insertAt) ? Math.min(insertAt, rows.length) : rows.length;
    rows.splice(idx, 0, row);
    return rows;
  });
}

/**
 * `inferLayoutGroupLabel` only knows how to strip Front/Rear/FF-style suffixes, so a set like
 * "Lower arm shim — Inner / — Outer" leaves the separator dangling. Trim it off.
 */
function groupLabelFor(fields: SetupSheetModelFieldDef[]): string {
  return inferLayoutGroupLabel(fields).replace(/[\s—–\-·:]+$/, "").trim();
}

function sharedUnit(fields: SetupSheetModelFieldDef[]): string | undefined {
  const units = [...new Set(fields.map((f) => f.unit?.trim()).filter(Boolean))];
  return units.length === 1 ? units[0] : undefined;
}

/** Drop a parameter into a specific slot; whoever was there is evicted to a single row below. */
export function assignFieldToSlot(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number,
  slotIndex: number,
  fieldKey: string
): OpResult {
  const adopted = adoptRowAsSlotsGroup(schema, sectionId, rowIndex);
  if ("error" in adopted) return adopted;

  const sec = adopted.structuredSections.find((s) => s.id === sectionId)!;
  const row = sec.rows[rowIndex];
  if (!row || row.type !== "slots") return { error: "Row is not a group." };
  const groupId = row.layoutGroupId;
  if (!groupId) return { error: "Row is not a group." };
  if (slotIndex < 0 || slotIndex >= row.slots.length) return { error: "Slot not found." };

  const field = adopted.fields.find((f) => f.key === fieldKey);
  if (!field) return { error: `Unknown parameter "${fieldKey}".` };

  const incumbent = row.slots[slotIndex]!.key;
  if (incumbent === fieldKey) return adopted;

  const fromIdx = row.slots.findIndex((s) => s.key === fieldKey);
  if (fromIdx >= 0) {
    // Same group: swap the two members rather than evicting anyone.
    let next = patchField(adopted, fieldKey, { layoutSlotIndex: slotIndex });
    next = patchField(next, incumbent, { layoutSlotIndex: fromIdx });
    return mapSection(next, sectionId, (rows) => {
      const slots = [...row.slots];
      slots[slotIndex] = { ...slots[slotIndex]!, key: fieldKey };
      slots[fromIdx] = { ...slots[fromIdx]!, key: incumbent };
      rows[rowIndex] = { ...row, slots };
      return rows;
    });
  }

  const section = adopted.structuredSections.find((s) => s.id === sectionId)!;
  let next = detachField(adopted, fieldKey);

  // detachField may have collapsed the target group (e.g. dragging a member out of a 2-slot row
  // into that same row's other slot); bail out to a plain move if the row is gone.
  const rowNow = next.structuredSections.find((s) => s.id === sectionId)?.rows[rowIndex];
  if (!rowNow || rowNow.type !== "slots" || rowNow.layoutGroupId !== groupId) {
    return moveFieldToSection(next, fieldKey, sectionId);
  }

  next = patchField(next, fieldKey, {
    sectionId,
    sectionTitle: section.title,
    layoutGroupId: groupId,
    layoutGroupRole: undefined,
    layoutSlotIndex: slotIndex,
  });
  next = patchField(next, incumbent, {
    layoutGroupId: undefined,
    layoutGroupRole: undefined,
    layoutSlotIndex: undefined,
  });

  const evicted = next.fields.find((f) => f.key === incumbent);
  return mapSection(next, sectionId, (rows) => {
    const target = rows[rowIndex];
    if (!target || target.type !== "slots") return rows;
    const slots = [...target.slots];
    slots[slotIndex] = { ...slots[slotIndex]!, key: fieldKey };
    rows[rowIndex] = { ...target, slots };
    if (evicted) rows.splice(rowIndex + 1, 0, singleRowFor(evicted));
    return rows;
  });
}

/** Append a parameter as a new slot on an existing group (max 6). */
export function appendFieldToGroup(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number,
  fieldKey: string,
  slotLabel?: string
): OpResult {
  const adopted = adoptRowAsSlotsGroup(schema, sectionId, rowIndex);
  if ("error" in adopted) return adopted;

  const sec = adopted.structuredSections.find((s) => s.id === sectionId)!;
  const row = sec.rows[rowIndex];
  if (!row || row.type !== "slots" || !row.layoutGroupId) return { error: "Row is not a group." };
  if (row.slots.length >= MAX_LAYOUT_SLOTS) {
    return { error: `A row can hold at most ${MAX_LAYOUT_SLOTS} parameters.` };
  }
  if (row.slots.some((s) => s.key === fieldKey)) return adopted;

  const field = adopted.fields.find((f) => f.key === fieldKey);
  if (!field) return { error: `Unknown parameter "${fieldKey}".` };

  const groupId = row.layoutGroupId;
  let next = detachField(adopted, fieldKey);

  const rowNow = next.structuredSections.find((s) => s.id === sectionId)?.rows[rowIndex];
  if (!rowNow || rowNow.type !== "slots" || rowNow.layoutGroupId !== groupId) {
    return moveFieldToSection(next, fieldKey, sectionId);
  }

  const slotIndex = rowNow.slots.length;
  const label = slotLabel?.trim() || DEFAULT_CORNER_SLOT_LABELS[slotIndex] || String(slotIndex + 1);
  const group = groups(next)[groupId]!;
  next = withGroups(next, {
    ...groups(next),
    [groupId]: { ...group, slotLabels: [...(group.slotLabels ?? []), label] },
  });
  next = patchField(next, fieldKey, {
    sectionId,
    sectionTitle: sec.title,
    layoutGroupId: groupId,
    layoutGroupRole: undefined,
    layoutSlotIndex: slotIndex,
  });

  return mapSection(next, sectionId, (rows) => {
    const target = rows[rowIndex];
    if (!target || target.type !== "slots") return rows;
    rows[rowIndex] = { ...target, slots: [...target.slots, { label, key: fieldKey }] };
    return rows;
  });
}

/** Remove one member from a group; below 2 members the group collapses to single rows. */
export function removeSlot(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number,
  slotIndex: number
): OpResult {
  const adopted = adoptRowAsSlotsGroup(schema, sectionId, rowIndex);
  if ("error" in adopted) return adopted;

  const row = adopted.structuredSections.find((s) => s.id === sectionId)?.rows[rowIndex];
  if (!row || row.type !== "slots" || !row.layoutGroupId) return { error: "Row is not a group." };
  const slot = row.slots[slotIndex];
  if (!slot) return { error: "Slot not found." };

  const next = patchField(adopted, slot.key, {
    layoutGroupId: undefined,
    layoutGroupRole: undefined,
    layoutSlotIndex: undefined,
  });
  const removed = removeSlotByKey(next, sectionId, rowIndex, row.layoutGroupId, slot.key);
  const field = removed.fields.find((f) => f.key === slot.key);
  if (!field) return removed;
  // Keep the parameter on the sheet — it becomes its own row directly below.
  if (collectModelLayoutKeys(removed.structuredSections).has(slot.key)) return removed;
  return mapSection(removed, sectionId, (rows) => {
    rows.splice(Math.min(rowIndex + 1, rows.length), 0, singleRowFor(field));
    return rows;
  });
}

export function setSlotLabel(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number,
  slotIndex: number,
  label: string
): OpResult {
  const adopted = adoptRowAsSlotsGroup(schema, sectionId, rowIndex);
  if ("error" in adopted) return adopted;

  const row = adopted.structuredSections.find((s) => s.id === sectionId)?.rows[rowIndex];
  if (!row || row.type !== "slots" || !row.layoutGroupId) return { error: "Row is not a group." };
  if (slotIndex < 0 || slotIndex >= row.slots.length) return { error: "Slot not found." };

  const trimmed = label.trim();
  const group = groups(adopted)[row.layoutGroupId]!;
  const slotLabels = [...(group.slotLabels ?? row.slots.map((s) => s.label))];
  slotLabels[slotIndex] = trimmed;

  const next = withGroups(adopted, {
    ...groups(adopted),
    [row.layoutGroupId]: { ...group, slotLabels },
  });
  return mapSection(next, sectionId, (rows) => {
    const target = rows[rowIndex];
    if (!target || target.type !== "slots") return rows;
    const slots = [...target.slots];
    slots[slotIndex] = { ...slots[slotIndex]!, label: trimmed };
    rows[rowIndex] = { ...target, slots };
    return rows;
  });
}

export function setGroupRowLabel(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number,
  label: string
): OpResult {
  const adopted = adoptRowAsSlotsGroup(schema, sectionId, rowIndex);
  if ("error" in adopted) return adopted;

  const row = adopted.structuredSections.find((s) => s.id === sectionId)?.rows[rowIndex];
  if (!row || row.type !== "slots" || !row.layoutGroupId) return { error: "Row is not a group." };

  const trimmed = label.trim();
  const group = groups(adopted)[row.layoutGroupId]!;
  const next = withGroups(adopted, {
    ...groups(adopted),
    [row.layoutGroupId]: { ...group, label: trimmed },
  });
  return mapSection(next, sectionId, (rows) => {
    const target = rows[rowIndex];
    if (!target || target.type !== "slots") return rows;
    rows[rowIndex] = { ...target, label: trimmed };
    return rows;
  });
}

/* -------------------------------------------------------------------- moving */

/** Move a parameter into any section as its own row. Detaches it from a group first. */
export function moveFieldToSection(
  schema: SetupSheetModelSchema,
  fieldKey: string,
  toSectionId: string,
  toIndex?: number
): OpResult {
  const field = schema.fields.find((f) => f.key === fieldKey);
  if (!field) return { error: `Unknown parameter "${fieldKey}".` };
  const title = sectionTitleFor(schema, toSectionId);

  let next = ensureSection(schema, toSectionId, title);
  next = detachField(next, fieldKey);
  next = patchField(next, fieldKey, { sectionId: toSectionId, sectionTitle: title });

  const moved = next.fields.find((f) => f.key === fieldKey)!;
  return mapSection(next, toSectionId, (rows) => {
    const idx = toIndex == null ? rows.length : Math.max(0, Math.min(toIndex, rows.length));
    rows.splice(idx, 0, singleRowFor(moved));
    return rows;
  });
}

/**
 * Move a whole row (single or group) to another section, or reorder within one.
 * Group rows carry their members' `sectionId` across with them.
 */
export function moveRow(
  schema: SetupSheetModelSchema,
  fromSectionId: string,
  fromIndex: number,
  toSectionId: string,
  toIndex: number
): OpResult {
  const from = schema.structuredSections.find((s) => s.id === fromSectionId);
  if (!from) return { error: "Section not found." };
  const row = from.rows[fromIndex];
  if (!row) return { error: "Row not found." };
  const title = sectionTitleFor(schema, toSectionId);

  let next = ensureSection(schema, toSectionId, title);
  next = mapSection(next, fromSectionId, (rows) => {
    rows.splice(fromIndex, 1);
    return rows;
  });

  let insertAt = toIndex;
  if (fromSectionId === toSectionId && fromIndex < toIndex) insertAt -= 1;

  next = mapSection(next, toSectionId, (rows) => {
    rows.splice(Math.max(0, Math.min(insertAt, rows.length)), 0, row);
    return rows;
  });

  if (fromSectionId !== toSectionId) {
    for (const key of layoutRowKeys(row)) {
      next = patchField(next, key, { sectionId: toSectionId, sectionTitle: title });
    }
    const groupId = rowGroupId(row);
    const group = groupId ? groups(next)[groupId] : undefined;
    if (groupId && group) {
      next = withGroups(next, { ...groups(next), [groupId]: { ...group, sectionId: toSectionId } });
    }
  }

  return next;
}

/* ------------------------------------------------------------------ sections */

function sectionIdFromTitle(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "section";
  let id = base;
  let n = 0;
  while (taken.has(id)) {
    n += 1;
    id = `${base}_${n}`;
  }
  return id;
}

export function addSection(schema: SetupSheetModelSchema, title: string): OpResult {
  const trimmed = title.trim();
  if (!trimmed) return { error: "Section title is required." };
  const taken = new Set([
    ...schema.structuredSections.map((s) => s.id),
    ...schema.fields.map((f) => f.sectionId),
  ]);
  const id = sectionIdFromTitle(trimmed, taken);
  return {
    ...schema,
    structuredSections: [...schema.structuredSections, { id, title: trimmed, rows: [] }],
  };
}

/**
 * Delete a section. Its parameters are **never** deleted — rows and field defs move to Other, so a
 * mis-click can't wipe a chassis type's calibration mapping.
 */
export function deleteSection(schema: SetupSheetModelSchema, sectionId: string): OpResult {
  const sec = schema.structuredSections.find((s) => s.id === sectionId);
  if (!sec) return { error: "Section not found." };
  if (sectionId === FALLBACK_SECTION_ID) return { error: "The Other section can't be deleted." };

  const orphanRows = [...sec.rows];
  let next = ensureSection(schema, FALLBACK_SECTION_ID, FALLBACK_SECTION_TITLE);

  next = {
    ...next,
    fields: next.fields.map((f) =>
      f.sectionId === sectionId
        ? { ...f, sectionId: FALLBACK_SECTION_ID, sectionTitle: FALLBACK_SECTION_TITLE }
        : f
    ),
  };

  const nextGroups = { ...groups(next) };
  for (const [id, g] of Object.entries(nextGroups)) {
    if (g.sectionId === sectionId) nextGroups[id] = { ...g, sectionId: FALLBACK_SECTION_ID };
  }
  next = withGroups(next, nextGroups);

  next = mapSection(next, FALLBACK_SECTION_ID, (rows) => [...rows, ...orphanRows]);
  return {
    ...next,
    structuredSections: next.structuredSections.filter((s) => s.id !== sectionId),
  };
}

/* ------------------------------------------------------- placing missing rows */

/**
 * Append rows for parameters that aren't on the sheet yet. Replaces the old "Rebuild layout" /
 * "Auto-group" buttons, which re-derived every section and threw away hand-made row order.
 * Rows already on the sheet are left byte-identical.
 */
export function placeMissingParameters(schema: SetupSheetModelSchema): SetupSheetModelSchema {
  const placed = collectModelLayoutKeys(schema.structuredSections);
  const missing = schema.fields.filter((f) => !placed.has(f.key));
  if (missing.length === 0) return schema;

  const bySection = new Map<string, SetupSheetModelFieldDef[]>();
  for (const f of missing) {
    const list = bySection.get(f.sectionId) ?? [];
    list.push(f);
    bySection.set(f.sectionId, list);
  }

  let next = schema;
  for (const [sectionId, fields] of bySection) {
    next = ensureSection(next, sectionId, fields[0]!.sectionTitle);
    // Inference runs over the missing fields only, so it can pair up a freshly-imported
    // FF/FR/RF/RR set without touching anything already placed.
    const rows = inferSectionLayoutRows(fields.filter((f) => !f.layoutGroupId));
    const stillMissing = fields.filter((f) => f.layoutGroupId);
    next = mapSection(next, sectionId, (existing) => [
      ...existing,
      ...rows,
      ...stillMissing.map(singleRowFor),
    ]);
  }
  return next;
}

/** Parameters with no row on the sheet (the canvas's unplaced tray). */
export function unplacedFields(schema: SetupSheetModelSchema): SetupSheetModelFieldDef[] {
  const placed = collectModelLayoutKeys(schema.structuredSections);
  return schema.fields.filter((f) => !placed.has(f.key));
}
