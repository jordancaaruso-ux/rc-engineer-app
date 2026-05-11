import type { CustomSetupFieldDefinition } from "@/lib/setupCalibrations/types";
import { suggestKeyFromPdfFieldName } from "@/lib/setupCalibrations/customFieldCatalog";

export type QuickCalibrationFieldKind =
  | "number"
  | "text"
  | "checkbox"
  | "one_of_many"
  | "many_of_many";

export type BuildQuickFieldParams = {
  id: string;
  key: string;
  displayLabel: string;
  kind: QuickCalibrationFieldKind;
  /** One label per line; required for one_of_many / many_of_many (min 2 non-empty). */
  optionLabels: string[];
  sectionId: string;
  sectionTitle: string;
  sortOrder: number;
};

function uniqueOptionValues(labels: string[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const raw = suggestKeyFromPdfFieldName(labels[i] ?? `opt_${i}`);
    let v = raw || `opt_${i}`;
    let n = 0;
    while (used.has(v)) {
      n += 1;
      v = `${raw}_${n}`;
    }
    used.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Builds a {@link CustomSetupFieldDefinition} for the calibration “quick add” flow.
 * Caller validates key uniqueness vs template + other custom fields.
 */
export function buildQuickCustomFieldDefinition(p: BuildQuickFieldParams): CustomSetupFieldDefinition {
  const base = {
    id: p.id,
    key: p.key.trim(),
    displayLabel: p.displayLabel.trim(),
    sectionId: p.sectionId,
    sectionTitle: p.sectionTitle,
    fieldDomain: "setup" as const,
    isMetadata: false,
    showInSetupSheet: true,
    showInAnalysis: true,
    isPdfExportable: true,
    sortOrder: p.sortOrder,
  };

  switch (p.kind) {
    case "number":
      return {
        ...base,
        valueType: "number",
        uiType: "text",
      };
    case "text":
      return {
        ...base,
        valueType: "string",
        uiType: "text",
      };
    case "checkbox":
      return {
        ...base,
        valueType: "boolean",
        uiType: "checkbox",
        checkedValue: "1",
        uncheckedValue: "",
      };
    case "one_of_many": {
      const labels = p.optionLabels.map((l) => l.trim()).filter(Boolean);
      const values = uniqueOptionValues(labels);
      const groupedOptions = labels.map((optionLabel, idx) => ({
        id: `${p.id}_opt_${idx}`,
        sourceKey: "",
        optionValue: values[idx]!,
        optionLabel,
        order: idx,
      }));
      return {
        ...base,
        valueType: "enum",
        uiType: "select",
        groupBehaviorType: "singleSelect",
        groupedOptions,
      };
    }
    case "many_of_many": {
      const labels = p.optionLabels.map((l) => l.trim()).filter(Boolean);
      const values = uniqueOptionValues(labels);
      const groupedOptions = labels.map((optionLabel, idx) => ({
        id: `${p.id}_opt_${idx}`,
        sourceKey: "",
        optionValue: values[idx]!,
        optionLabel,
        order: idx,
      }));
      return {
        ...base,
        valueType: "multi",
        uiType: "multiSelect",
        groupBehaviorType: "visualMulti",
        groupedOptions,
      };
    }
  }
}
