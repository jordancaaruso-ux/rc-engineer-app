import type { SetupFieldMeta } from "@/lib/setupFieldCatalog";
import type { SetupSheetModelSchema, SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";
import type { CalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";

export function buildCatalogFromModelSchema(schema: SetupSheetModelSchema): SetupFieldMeta[] {
  const out: SetupFieldMeta[] = [];
  const seen = new Set<string>();
  for (const f of [...schema.fields].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))) {
    if (!f.key || seen.has(f.key)) continue;
    seen.add(f.key);
    out.push(modelFieldToMeta(f));
  }
  return out;
}

function modelFieldToMeta(f: SetupSheetModelFieldDef): SetupFieldMeta {
  return {
    key: f.key,
    label: f.displayLabel,
    groupId: f.sectionId,
    groupTitle: f.sectionTitle,
    unit: f.unit,
  };
}

function logicalKindFromModelField(f: SetupSheetModelFieldDef): CalibrationFieldKind {
  if (f.uiType === "checkbox" || f.valueType === "boolean") return "boolean";
  if (f.uiType === "select" || f.groupBehaviorType === "singleSelect" || f.groupBehaviorType === "singleChoiceGroup") {
    return "singleSelect";
  }
  if (f.uiType === "multiSelect" || f.valueType === "multi") return "visualMulti";
  if (f.valueType === "number") return "number";
  return "text";
}

export function modelFieldKeys(schema: SetupSheetModelSchema): Set<string> {
  return new Set(schema.fields.map((f) => f.key));
}

/** Reserved keys for custom/quick-add when editing calibrations for this model. */
export function reservedKeysForModel(schema: SetupSheetModelSchema): Set<string> {
  return modelFieldKeys(schema);
}

export function getLogicalFieldKindForModelKey(
  schema: SetupSheetModelSchema,
  key: string
): CalibrationFieldKind {
  const f = schema.fields.find((x) => x.key === key);
  if (f) return logicalKindFromModelField(f);
  return "text";
}
