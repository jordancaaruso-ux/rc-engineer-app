import { suggestKeyFromPdfFieldName } from "@/lib/setupCalibrations/customFieldCatalog";
import { groupedOptionValueFromLabel } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";
import type { QuickCalibrationFieldKind } from "@/lib/setupCalibrations/quickCalibrationField";

export type SchemaParameterKind =
  | "number"
  | "text"
  | "checkbox"
  | "one_of_many"
  | "many_of_many";

export function schemaKindFromField(f: SetupSheetModelFieldDef): SchemaParameterKind {
  const groupedLabels = f.groupedOptionLabels?.length ?? 0;
  if (groupedLabels >= 2) {
    if (
      f.groupBehaviorType === "singleSelect"
      || f.groupBehaviorType === "singleChoiceGroup"
      || f.uiType === "select"
    ) {
      return "one_of_many";
    }
    return "many_of_many";
  }
  if (f.uiType === "checkbox" || f.valueType === "boolean") return "checkbox";
  if (f.uiType === "select" || f.groupBehaviorType === "singleSelect" || f.groupBehaviorType === "singleChoiceGroup") {
    return "one_of_many";
  }
  if (f.uiType === "multiSelect" || f.groupBehaviorType === "multiChoiceGroup") return "many_of_many";
  if (f.valueType === "number") return "number";
  return "text";
}

export function buildFieldDefFromKind(input: {
  displayLabel: string;
  key?: string;
  kind: SchemaParameterKind;
  sectionId: string;
  sectionTitle: string;
  unit?: string;
  optionLabels?: string[];
  sortOrder: number;
}): SetupSheetModelFieldDef | { error: string } {
  const displayLabel = input.displayLabel.trim();
  if (!displayLabel) return { error: "Label is required." };
  const key = (input.key?.trim() || suggestKeyFromPdfFieldName(displayLabel)).trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
    return { error: "Key must be lowercase snake_case." };
  }

  const base = {
    key,
    displayLabel,
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    showInSetupSheet: true,
    showInAnalysis: true,
    sortOrder: input.sortOrder,
    unit: input.unit?.trim() || undefined,
  };

  switch (input.kind) {
    case "number":
      return { ...base, valueType: "number", uiType: "text" };
    case "text":
      return { ...base, valueType: "string", uiType: "textarea" };
    case "checkbox":
      return { ...base, valueType: "boolean", uiType: "checkbox" };
    case "one_of_many": {
      const labels = (input.optionLabels ?? []).map((l) => l.trim()).filter(Boolean);
      if (labels.length < 2) return { error: "One of many needs at least 2 options." };
      const values = labels.map((l, i) => groupedOptionValueFromLabel(l, i));
      return {
        ...base,
        valueType: "enum",
        uiType: "select",
        groupBehaviorType: "singleSelect",
        groupedOptionLabels: labels,
        groupedOptionValues: values,
      };
    }
    case "many_of_many": {
      const labels = (input.optionLabels ?? []).map((l) => l.trim()).filter(Boolean);
      if (labels.length < 2) return { error: "Many of many needs at least 2 options." };
      const values = labels.map((l, i) => groupedOptionValueFromLabel(l, i));
      return {
        ...base,
        valueType: "multi",
        uiType: "multiSelect",
        groupBehaviorType: "multiChoiceGroup",
        groupedOptionLabels: labels,
        groupedOptionValues: values,
      };
    }
    default:
      return { error: "Unknown parameter type." };
  }
}

export function quickKindToSchemaKind(k: QuickCalibrationFieldKind): SchemaParameterKind {
  return k;
}
