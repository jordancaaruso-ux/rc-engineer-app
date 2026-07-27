import type { SetupSheetFieldChipOptions, SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { normalizeGroupedFieldOnField } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import { filterModelLayoutSectionsByKeys } from "@/lib/setupSheetModels/filterStructuredLayoutByKeys";
import { placeMissingParameters } from "@/lib/setupSheetModels/layoutCanvasOps";
import {
  modelLayoutToStructuredSections,
  parseSetupSheetModelSchema,
  type SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";

export type SetupSheetTemplateView = "setup" | "logRun" | "analysis";

export function buildSetupSheetTemplateFromModel(
  modelId: string,
  modelName: string,
  schemaJson: unknown,
  view: SetupSheetTemplateView = "setup",
  templateKey?: string | null
): SetupSheetTemplate | null {
  const schema = parseSetupSheetModelSchema(schemaJson);
  if (!schema) return null;
  return buildSetupSheetTemplateFromParsedSchema(modelId, modelName, schema, view, templateKey);
}

export function buildSetupSheetTemplateFromParsedSchema(
  modelId: string,
  modelName: string,
  schema: SetupSheetModelSchema,
  view: SetupSheetTemplateView = "setup",
  /** Chassis-type key, so per-car surfaces (computed geometry) don't guess from field names. */
  templateKey?: string | null
): SetupSheetTemplate {
  const fieldByKey = new Map(schema.fields.map((f) => [f.key, f]));
  const isKeyVisible = (key: string): boolean => {
    const f = fieldByKey.get(key);
    if (f) {
      if (view === "logRun") return f.showInLogRun;
      if (view === "analysis") return f.showInAnalysis;
      return f.showInSetupSheet;
    }
    return true;
  };
  const visibleFields = schema.fields.filter((f) => {
    if (view === "logRun") return f.showInLogRun;
    if (view === "analysis") return f.showInAnalysis;
    return f.showInSetupSheet;
  });
  // A sheet built box-first has no layout until it's arranged and saved, and the flat
  // one-field-per-row fallback throws away the Front/Rear and corner pairings the key suffixes
  // already describe. Infer the same layout the schema editor would produce, so the view reads
  // grouped either way and saving an arrangement only ever refines it.
  const hasSavedLayout = schema.structuredSections.some((s) => s.rows.length > 0);
  const layoutSource = hasSavedLayout ? schema : placeMissingParameters(schema);
  const filteredLayoutSections = filterModelLayoutSectionsByKeys(
    layoutSource.structuredSections,
    isKeyVisible
  );
  const layoutSchema: SetupSheetModelSchema = {
    ...layoutSource,
    structuredSections: filteredLayoutSections,
  };
  const structuredSections = modelLayoutToStructuredSections(layoutSchema);
  const groups = groupFieldsBySection(visibleFields);
  const fieldChipOptionsByKey = buildFieldChipOptionsFromSchema(schema);

  return {
    id: `model-${modelId}`,
    label: schema.label || modelName,
    structuredSections,
    groups,
    fieldChipOptionsByKey,
    templateKey: templateKey ?? null,
  };
}

function buildFieldChipOptionsFromSchema(
  schema: SetupSheetModelSchema
): Record<string, SetupSheetFieldChipOptions> {
  const out: Record<string, SetupSheetFieldChipOptions> = {};
  for (const f of schema.fields) {
    const normalized = normalizeGroupedFieldOnField(f);
    const labels = normalized.groupedOptionLabels?.map((l) => l.trim()).filter(Boolean) ?? [];
    if (labels.length < 2) continue;
    const values = normalized.groupedOptionValues?.map((v) => v.trim()).filter(Boolean);
    const optionValues =
      values && values.length === labels.length ? values : undefined;
    const multi =
      normalized.uiType === "multiSelect"
      || normalized.valueType === "multi"
      || normalized.groupBehaviorType === "multiChoiceGroup"
      || normalized.groupBehaviorType === "visualMulti";
    out[f.key] = { options: labels, ...(optionValues ? { optionValues } : {}), multi };
  }
  return out;
}

function groupFieldsBySection(
  fields: SetupSheetModelSchema["fields"]
): SetupSheetTemplate["groups"] {
  const bySec = new Map<string, { title: string; fields: SetupSheetTemplate["groups"][0]["fields"] }>();
  const sorted = [...fields].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  for (const f of sorted) {
    let g = bySec.get(f.sectionId);
    if (!g) {
      g = { title: f.sectionTitle, fields: [] };
      bySec.set(f.sectionId, g);
    }
    g.fields.push({
      key: f.key,
      label: f.displayLabel,
      unit: f.unit,
      editable: true,
      input: f.uiType === "checkbox" ? "checkbox" : "text",
      valueType: f.valueType,
    });
  }
  return [...bySec.entries()].map(([id, g]) => ({
    id,
    title: g.title,
    column: "full" as const,
    fields: g.fields,
  }));
}
