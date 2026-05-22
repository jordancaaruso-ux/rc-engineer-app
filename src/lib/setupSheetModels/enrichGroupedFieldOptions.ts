import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import type { GroupedFieldBehaviorType } from "@/lib/setupCalibrations/types";
import {
  AWESOMATIX_MULTI_SELECT_GROUPS,
  AWESOMATIX_SINGLE_CHOICE_GROUPS,
} from "@/lib/setupDocuments/awesomatixWidgetGroups";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

/** Stable stored value for a grouped option label (keeps "1","2" as-is). */
export function groupedOptionValueFromLabel(label: string, index: number): string {
  const t = label.trim();
  if (/^[0-9]+$/.test(t)) return t;
  const slug = t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (slug && /^[a-z]/.test(slug)) return slug;
  if (slug) return `f_${slug}`;
  return `opt_${index + 1}`;
}

/** Fill grouped option metadata from Awesomatix catalog when the DB schema row is missing it. */
export function enrichGroupedOptionsOnField(field: SetupSheetModelFieldDef): SetupSheetModelFieldDef {
  const hasOptions = (field.groupedOptionLabels?.length ?? 0) >= 2;
  if (hasOptions) {
    const labels = field.groupedOptionLabels!;
    const values =
      field.groupedOptionValues?.length === labels.length
        ? field.groupedOptionValues!
        : labels.map(groupedOptionValueFromLabel);
    let groupBehaviorType = field.groupBehaviorType;
    if (!groupBehaviorType && field.key in AWESOMATIX_MULTI_SELECT_GROUPS) {
      groupBehaviorType = "visualMulti";
    }
    if (!groupBehaviorType && field.key in AWESOMATIX_SINGLE_CHOICE_GROUPS) {
      groupBehaviorType = "singleSelect";
    }
    return { ...field, groupedOptionValues: values, groupBehaviorType };
  }

  const single = AWESOMATIX_SINGLE_CHOICE_GROUPS[field.key];
  if (single && single.length >= 2) {
    return {
      ...field,
      uiType: field.uiType === "select" ? "select" : field.uiType,
      valueType: field.valueType === "enum" ? "enum" : "string",
      groupedOptionLabels: [...single],
      groupedOptionValues: single.map((l, i) => groupedOptionValueFromLabel(l, i)),
      groupBehaviorType: "singleSelect" satisfies GroupedFieldBehaviorType,
    };
  }

  const multi = AWESOMATIX_MULTI_SELECT_GROUPS[field.key];
  if (multi && multi.length >= 2) {
    return {
      ...field,
      uiType: "multiSelect",
      valueType: field.valueType === "multi" ? "multi" : "multi",
      groupedOptionLabels: [...multi],
      groupedOptionValues: multi.map((l, i) => groupedOptionValueFromLabel(l, i)),
      groupBehaviorType: "visualMulti",
    };
  }

  const kind = getCalibrationFieldKind(field.key);
  if (kind === "visualMulti" && !field.groupBehaviorType) {
    return { ...field, groupBehaviorType: "visualMulti" };
  }

  return field;
}

export function enrichSetupSheetModelSchemaFields(
  fields: SetupSheetModelFieldDef[]
): SetupSheetModelFieldDef[] {
  return fields.map(enrichGroupedOptionsOnField);
}
