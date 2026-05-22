import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import {
  modelLayoutToStructuredSections,
  parseSetupSheetModelSchema,
  type SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";

export function buildSetupSheetTemplateFromModel(
  modelId: string,
  modelName: string,
  schemaJson: unknown
): SetupSheetTemplate | null {
  const schema = parseSetupSheetModelSchema(schemaJson);
  if (!schema) return null;
  return buildSetupSheetTemplateFromParsedSchema(modelId, modelName, schema);
}

export function buildSetupSheetTemplateFromParsedSchema(
  modelId: string,
  modelName: string,
  schema: SetupSheetModelSchema
): SetupSheetTemplate {
  const structuredSections = modelLayoutToStructuredSections(schema);
  const visibleFields = schema.fields.filter((f) => f.showInSetupSheet);
  const groups = groupFieldsBySection(visibleFields);

  return {
    id: `model-${modelId}`,
    label: schema.label || modelName,
    structuredSections,
    groups,
  };
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
