import type { StructuredSection, StructuredRow } from "@/lib/a800rrSetupDisplayConfig";
import type {
  CustomFieldUiType,
  CustomFieldValueType,
  GroupedFieldBehaviorType,
} from "@/lib/setupCalibrations/types";

/**
 * `slots` is the shape the editor works in: 2–6 free-labelled cells. `pair` / `corner4` are the
 * legacy kinds — still parsed and still emitted by auto-inference, never created by hand.
 */
export type LayoutGroupKind = "pair" | "corner4" | "slots";
export type LayoutGroupRole = "front" | "rear" | "ff" | "fr" | "rf" | "rr";

export const MIN_LAYOUT_SLOTS = 2;
export const MAX_LAYOUT_SLOTS = 6;

/** Manual layout grouping metadata (pair / corner4 / slots rows). */
export type SetupSheetLayoutGroup = {
  id: string;
  kind: LayoutGroupKind;
  label: string;
  /** When true, auto-group / rebuild keeps this group intact. */
  manual: boolean;
  sectionId: string;
  /** `slots` only: ordered slot labels, length 2–6. Member fields index into this by layoutSlotIndex. */
  slotLabels?: string[];
};

/** One parameter on a setup sheet model (schema-first). */
export type SetupSheetModelFieldDef = {
  key: string;
  displayLabel: string;
  sectionId: string;
  sectionTitle: string;
  valueType: CustomFieldValueType;
  uiType: CustomFieldUiType;
  unit?: string;
  showInSetupSheet: boolean;
  showInAnalysis: boolean;
  /** When false, hidden on Log your run (independent of full setup sheet visibility). */
  showInLogRun: boolean;
  sortOrder: number;
  /** For one-of-many / many-of-many: option labels and stored values. */
  groupBehaviorType?: GroupedFieldBehaviorType;
  groupedOptionLabels?: string[];
  groupedOptionValues?: string[];
  notes?: string;
  /**
   * When set, equals {@link canonicalAggregationParameterKey} for cross-car stats
   * (e.g. `damper_oil_front` even if this sheet labels the row "Shock oil").
   *
   * Only for genuinely the SAME measurement under a different name — droop and downstop read
   * different numbers off the same car and each have their own id.
   */
  universalParameterId?: string;
  /** Links field to a manual pair / corner4 / slots layout group. */
  layoutGroupId?: string;
  /** Legacy pair / corner4 groups only. */
  layoutGroupRole?: LayoutGroupRole;
  /** `slots` groups: which cell of the group this field occupies. */
  layoutSlotIndex?: number;
};

export type SetupSheetModelLayoutRow =
  | { type: "single"; key: string; label: string; unit?: string; multiline?: boolean }
  | {
      type: "pair";
      label: string;
      unit?: string;
      leftKey: string;
      rightKey: string;
      layoutGroupId?: string;
    }
  | {
      type: "corner4";
      ff: string;
      fr: string;
      rf: string;
      rr: string;
      label: string;
      unit?: string;
      layoutGroupId?: string;
    }
  | {
      type: "slots";
      label: string;
      unit?: string;
      slots: { label: string; key: string }[];
      layoutGroupId?: string;
    }
  | {
      type: "screw_strip";
      key: "motor_mount_screws" | "top_deck_screws" | "top_deck_cuts";
      label: string;
    }
  | { type: "top_deck_block" };

export type SetupSheetModelSchema = {
  version: 1;
  label: string;
  /** Structured layout for SetupSheetView. */
  structuredSections: Array<{
    id: string;
    title: string;
    rows: SetupSheetModelLayoutRow[];
  }>;
  fields: SetupSheetModelFieldDef[];
  /** Manual layout groups keyed by group id. */
  layoutGroups?: Record<string, SetupSheetLayoutGroup>;
};

export function parseSetupSheetModelSchema(raw: unknown): SetupSheetModelSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label.trim() : "Setup sheet";
  const fieldsRaw = Array.isArray(r.fields) ? r.fields : [];
  const fields: SetupSheetModelFieldDef[] = [];
  for (const item of fieldsRaw) {
    const f = parseFieldDef(item);
    if (f) fields.push(f);
  }
  const sectionsRaw = Array.isArray(r.structuredSections) ? r.structuredSections : [];
  const structuredSections: SetupSheetModelSchema["structuredSections"] = [];
  for (const sec of sectionsRaw) {
    if (!sec || typeof sec !== "object") continue;
    const s = sec as Record<string, unknown>;
    const id = typeof s.id === "string" ? s.id.trim() : "";
    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (!id) continue;
    const rowsRaw = Array.isArray(s.rows) ? s.rows : [];
    const rows: SetupSheetModelLayoutRow[] = [];
    for (const row of rowsRaw) {
      const parsed = parseLayoutRow(row);
      if (parsed) rows.push(parsed);
    }
    structuredSections.push({ id, title: title || id, rows });
  }
  const layoutGroups = parseLayoutGroups(r.layoutGroups);

  return {
    version: 1,
    label,
    structuredSections,
    fields,
    ...(layoutGroups ? { layoutGroups } : {}),
  };
}

function parseLayoutGroups(raw: unknown): Record<string, SetupSheetLayoutGroup> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, SetupSheetLayoutGroup> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const g = value as Record<string, unknown>;
    const kind =
      g.kind === "pair" || g.kind === "corner4" || g.kind === "slots" ? g.kind : null;
    const label = typeof g.label === "string" ? g.label.trim() : "";
    const sectionId = typeof g.sectionId === "string" ? g.sectionId.trim() : "";
    if (!kind || !label || !sectionId) continue;
    if (kind === "slots") {
      const slotLabels = parseSlotLabels(g.slotLabels);
      // A slots group without usable labels can't be rendered — drop it rather than half-build it.
      if (!slotLabels) continue;
      out[id] = { id, kind, label, sectionId, manual: g.manual !== false, slotLabels };
      continue;
    }
    out[id] = {
      id,
      kind,
      label,
      sectionId,
      manual: g.manual !== false,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Slot labels are blank-tolerant (an unnamed cell is legal) but the count must be 2–6. */
function parseSlotLabels(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const labels = raw.map((x) => (typeof x === "string" ? x.trim() : ""));
  if (labels.length < MIN_LAYOUT_SLOTS || labels.length > MAX_LAYOUT_SLOTS) return null;
  return labels;
}

function parseFieldDef(raw: unknown): SetupSheetModelFieldDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" ? r.key.trim() : "";
  const displayLabel = typeof r.displayLabel === "string" ? r.displayLabel.trim() : "";
  if (!key || !displayLabel) return null;
  const sectionId = typeof r.sectionId === "string" && r.sectionId.trim() ? r.sectionId.trim() : "other";
  const sectionTitle =
    typeof r.sectionTitle === "string" && r.sectionTitle.trim() ? r.sectionTitle.trim() : "Other";
  const valueType = (typeof r.valueType === "string" ? r.valueType : "string") as CustomFieldValueType;
  const uiType = (typeof r.uiType === "string" ? r.uiType : "text") as CustomFieldUiType;
  const sortOrder = typeof r.sortOrder === "number" && Number.isFinite(r.sortOrder) ? r.sortOrder : 0;
  const groupBehaviorRaw = typeof r.groupBehaviorType === "string" ? r.groupBehaviorType.trim() : "";
  const groupBehaviorType = ["singleChoiceGroup", "singleSelect", "visualMulti", "multiChoiceGroup"].includes(
    groupBehaviorRaw
  )
    ? (groupBehaviorRaw as GroupedFieldBehaviorType)
    : undefined;
  const groupedOptionLabels = Array.isArray(r.groupedOptionLabels)
    ? r.groupedOptionLabels.map((x) => String(x).trim()).filter(Boolean)
    : undefined;
  const groupedOptionValues = Array.isArray(r.groupedOptionValues)
    ? r.groupedOptionValues.map((x) => String(x).trim()).filter(Boolean)
    : undefined;
  return {
    key,
    displayLabel,
    sectionId,
    sectionTitle,
    valueType,
    uiType,
    unit: typeof r.unit === "string" ? r.unit.trim() || undefined : undefined,
    showInSetupSheet: r.showInSetupSheet !== false,
    showInAnalysis: r.showInAnalysis !== false,
    showInLogRun:
      typeof r.showInLogRun === "boolean" ? r.showInLogRun : r.showInSetupSheet !== false,
    sortOrder,
    groupBehaviorType,
    groupedOptionLabels,
    groupedOptionValues,
    notes: typeof r.notes === "string" ? r.notes.trim() || undefined : undefined,
    universalParameterId:
      typeof r.universalParameterId === "string" && r.universalParameterId.trim()
        ? r.universalParameterId.trim()
        : undefined,
    layoutGroupId:
      typeof r.layoutGroupId === "string" && r.layoutGroupId.trim() ? r.layoutGroupId.trim() : undefined,
    layoutGroupRole: parseLayoutGroupRole(r.layoutGroupRole),
    layoutSlotIndex:
      typeof r.layoutSlotIndex === "number"
        && Number.isInteger(r.layoutSlotIndex)
        && r.layoutSlotIndex >= 0
        && r.layoutSlotIndex < MAX_LAYOUT_SLOTS
        ? r.layoutSlotIndex
        : undefined,
  };
}

function parseLayoutGroupRole(raw: unknown): LayoutGroupRole | undefined {
  if (raw === "front" || raw === "rear" || raw === "ff" || raw === "fr" || raw === "rf" || raw === "rr") {
    return raw;
  }
  return undefined;
}

function parseLayoutRow(raw: unknown): SetupSheetModelLayoutRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (type === "single") {
    const key = typeof r.key === "string" ? r.key.trim() : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!key) return null;
    return {
      type: "single",
      key,
      label: label || key,
      unit: typeof r.unit === "string" ? r.unit.trim() || undefined : undefined,
      multiline: r.multiline === true,
    };
  }
  if (type === "pair") {
    const leftKey = typeof r.leftKey === "string" ? r.leftKey.trim() : "";
    const rightKey = typeof r.rightKey === "string" ? r.rightKey.trim() : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!leftKey || !rightKey) return null;
    return {
      type: "pair",
      label: label || leftKey,
      unit: typeof r.unit === "string" ? r.unit.trim() || undefined : undefined,
      leftKey,
      rightKey,
      layoutGroupId:
        typeof r.layoutGroupId === "string" && r.layoutGroupId.trim() ? r.layoutGroupId.trim() : undefined,
    };
  }
  if (type === "corner4") {
    const ff = typeof r.ff === "string" ? r.ff.trim() : "";
    const fr = typeof r.fr === "string" ? r.fr.trim() : "";
    const rf = typeof r.rf === "string" ? r.rf.trim() : "";
    const rr = typeof r.rr === "string" ? r.rr.trim() : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!ff || !fr || !rf || !rr) return null;
    return {
      type: "corner4",
      ff,
      fr,
      rf,
      rr,
      label: label || "Corner",
      unit: typeof r.unit === "string" ? r.unit.trim() || undefined : undefined,
      layoutGroupId:
        typeof r.layoutGroupId === "string" && r.layoutGroupId.trim() ? r.layoutGroupId.trim() : undefined,
    };
  }
  if (type === "slots") {
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const slotsRaw = Array.isArray(r.slots) ? r.slots : [];
    const slots: { label: string; key: string }[] = [];
    for (const slot of slotsRaw) {
      if (!slot || typeof slot !== "object") continue;
      const s = slot as Record<string, unknown>;
      const key = typeof s.key === "string" ? s.key.trim() : "";
      if (!key) continue;
      slots.push({ key, label: typeof s.label === "string" ? s.label.trim() : "" });
    }
    if (slots.length < MIN_LAYOUT_SLOTS || slots.length > MAX_LAYOUT_SLOTS) return null;
    return {
      type: "slots",
      label: label || slots[0]!.key,
      unit: typeof r.unit === "string" ? r.unit.trim() || undefined : undefined,
      slots,
      layoutGroupId:
        typeof r.layoutGroupId === "string" && r.layoutGroupId.trim() ? r.layoutGroupId.trim() : undefined,
    };
  }
  if (type === "screw_strip") {
    const key = r.key;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (key !== "motor_mount_screws" && key !== "top_deck_screws" && key !== "top_deck_cuts") return null;
    return { type: "screw_strip", key, label: label || key };
  }
  if (type === "top_deck_block") {
    return { type: "top_deck_block" };
  }
  return null;
}

/** Convert model layout rows to StructuredSection rows for SetupSheetView. */
export function modelLayoutToStructuredSections(
  schema: SetupSheetModelSchema
): StructuredSection[] {
  return schema.structuredSections.map((sec) => ({
    id: sec.id,
    title: sec.title,
    rows: sec.rows.map((row): StructuredRow => {
      if (row.type === "single") {
        const field = schema.fields.find((f) => f.key === row.key);
        const kind = fieldKindFromModelField(field);
        return {
          type: "single",
          key: row.key,
          label: row.label,
          unit: row.unit,
          fieldKind: kind,
          multiline: row.multiline,
        };
      }
      if (row.type === "corner4") {
        return {
          type: "corner4",
          ff: row.ff,
          fr: row.fr,
          rf: row.rf,
          rr: row.rr,
          label: row.label,
          unit: row.unit,
        };
      }
      if (row.type === "slots") {
        return slotsRowToStructuredRow(row, schema.fields);
      }
      if (row.type === "screw_strip") {
        return { type: "screw_strip", key: row.key, label: row.label };
      }
      if (row.type === "top_deck_block") {
        return { type: "top_deck_block" };
      }
      const left = schema.fields.find((f) => f.key === row.leftKey);
      const right = schema.fields.find((f) => f.key === row.rightKey);
      const kind =
        left?.uiType === "checkbox" || right?.uiType === "checkbox" ? ("bool" as const) : undefined;
      return {
        type: "pair",
        label: row.label,
        unit: row.unit,
        leftKey: row.leftKey,
        rightKey: row.rightKey,
        fieldKind: kind,
      };
    }),
  }));
}

const CLASSIC_CORNER_SLOT_LABELS = ["ff", "fr", "rf", "rr"];
const CLASSIC_PAIR_SLOT_LABELS = ["front", "rear"];

function slotLabelsMatch(slots: { label: string }[], expected: string[]): boolean {
  if (slots.length !== expected.length) return false;
  return slots.every((s, i) => s.label.trim().toLowerCase() === expected[i]);
}

/**
 * Display boundary for `slots` rows. A group that is genuinely FF/FR/RF/RR (or Front/Rear) renders
 * through the long-standing corner4 / pair components so existing sheets stay pixel-identical;
 * only genuinely custom shapes reach the flat N-across renderer.
 */
function slotsRowToStructuredRow(
  row: Extract<SetupSheetModelLayoutRow, { type: "slots" }>,
  fields: SetupSheetModelFieldDef[]
): StructuredRow {
  const members = row.slots.map((s) => fields.find((f) => f.key === s.key));
  const kind = members.some((f) => f?.uiType === "checkbox") ? ("bool" as const) : undefined;
  // Spread conditionally: an explicit `fieldKind: undefined` would make an adopted classic row
  // structurally different from the same row before adoption.
  const fieldKind = kind ? { fieldKind: kind } : {};

  if (slotLabelsMatch(row.slots, CLASSIC_CORNER_SLOT_LABELS)) {
    return {
      type: "corner4",
      ff: row.slots[0]!.key,
      fr: row.slots[1]!.key,
      rf: row.slots[2]!.key,
      rr: row.slots[3]!.key,
      label: row.label,
      unit: row.unit,
      ...fieldKind,
    };
  }
  if (slotLabelsMatch(row.slots, CLASSIC_PAIR_SLOT_LABELS)) {
    return {
      type: "pair",
      leftKey: row.slots[0]!.key,
      rightKey: row.slots[1]!.key,
      label: row.label,
      unit: row.unit,
      ...fieldKind,
    };
  }
  return {
    type: "slots",
    label: row.label,
    unit: row.unit,
    slots: row.slots.map((s) => ({ label: s.label, key: s.key })),
    ...fieldKind,
  };
}

function fieldKindFromModelField(
  field: SetupSheetModelFieldDef | undefined
): "text" | "bool" | "multi" | undefined {
  if (!field) return undefined;
  if (field.uiType === "checkbox") return "bool";
  if (field.uiType === "multiSelect" || field.valueType === "multi") return "multi";
  return undefined;
}
