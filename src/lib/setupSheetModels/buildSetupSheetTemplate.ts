import type { SetupSheetFieldChipOptions, SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { normalizeGroupedFieldOnField } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import { filterModelLayoutSectionsByKeys } from "@/lib/setupSheetModels/filterStructuredLayoutByKeys";
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
  view: SetupSheetTemplateView = "setup"
): SetupSheetTemplate | null {
  const schema = parseSetupSheetModelSchema(schemaJson);
  if (!schema) return null;
  return buildSetupSheetTemplateFromParsedSchema(modelId, modelName, schema, view);
}

export function buildSetupSheetTemplateFromParsedSchema(
  modelId: string,
  modelName: string,
  schema: SetupSheetModelSchema,
  view: SetupSheetTemplateView = "setup"
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
  const filteredLayoutSections = filterModelLayoutSectionsByKeys(schema.structuredSections, isKeyVisible);
  const layoutSchema: SetupSheetModelSchema = {
    ...schema,
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
  };
}

function buildFieldChipOptionsFromSchema(
  schema: SetupSheetModelSchema
): Record<string, SetupSheetFieldChipOptions> | undefined {
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
  return Object.keys(out).length > 0 ? out : undefined;
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
    });
  }
  return [...bySec.entries()].map(([id, g]) => ({
    id,
    title: g.title,
    column: "full" as const,
    fields: g.fields,
  }));
}
