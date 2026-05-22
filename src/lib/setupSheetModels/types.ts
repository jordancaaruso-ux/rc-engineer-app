import type { StructuredSection, StructuredRow } from "@/lib/a800rrSetupDisplayConfig";
import type {
  CustomFieldUiType,
  CustomFieldValueType,
  GroupedFieldBehaviorType,
} from "@/lib/setupCalibrations/types";

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
  sortOrder: number;
  /** For one-of-many / many-of-many: option labels and stored values. */
  groupBehaviorType?: GroupedFieldBehaviorType;
  groupedOptionLabels?: string[];
  groupedOptionValues?: string[];
  notes?: string;
};

export type SetupSheetModelLayoutRow =
  | { type: "single"; key: string; label: string; unit?: string; multiline?: boolean }
  | {
      type: "pair";
      label: string;
      unit?: string;
      leftKey: string;
      rightKey: string;
    };

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
  return {
    version: 1,
    label,
    structuredSections,
    fields,
  };
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
    sortOrder,
    groupBehaviorType,
    groupedOptionLabels,
    groupedOptionValues,
    notes: typeof r.notes === "string" ? r.notes.trim() || undefined : undefined,
  };
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
    };
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

function fieldKindFromModelField(
  field: SetupSheetModelFieldDef | undefined
): "text" | "bool" | "multi" | undefined {
  if (!field) return undefined;
  if (field.uiType === "checkbox") return "bool";
  if (field.uiType === "multiSelect" || field.valueType === "multi") return "multi";
  if (field.uiType === "select" || field.groupBehaviorType) return "multi";
  return undefined;
}
