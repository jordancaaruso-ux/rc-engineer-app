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

function defaultGroupBehaviorFromField(f: SetupSheetModelFieldDef): GroupedFieldBehaviorType | undefined {
  if (f.groupBehaviorType) return f.groupBehaviorType;
  if (f.uiType === "select" || f.valueType === "enum") return "singleSelect";
  if (f.uiType === "multiSelect" || f.valueType === "multi") return "multiChoiceGroup";
  const labelCount = f.groupedOptionLabels?.length ?? 0;
  if (labelCount < 2) return undefined;
  if (f.groupBehaviorType === "singleChoiceGroup") return "singleSelect";
  return "multiChoiceGroup";
}

/**
 * Normalize grouped metadata stored on the sheet model — schema is the source of truth.
 * Does not inject Awesomatix/A800 catalog options or types by field key.
 */
export function normalizeGroupedFieldOnField(field: SetupSheetModelFieldDef): SetupSheetModelFieldDef {
  const labels = field.groupedOptionLabels ?? [];
  if (labels.length < 2) return field;

  const values =
    field.groupedOptionValues?.length === labels.length
      ? field.groupedOptionValues!
      : labels.map(groupedOptionValueFromLabel);

  const groupBehaviorType = defaultGroupBehaviorFromField(field) ?? field.groupBehaviorType;

  return {
    ...field,
    groupedOptionValues: values,
    ...(groupBehaviorType ? { groupBehaviorType } : {}),
  };
}

export function normalizeSetupSheetModelSchemaFields(
  fields: SetupSheetModelFieldDef[]
): SetupSheetModelFieldDef[] {
  return fields.map(normalizeGroupedFieldOnField);
}

/**
 * One-time defaults when building the platform A800 seed schema (stored in schemaJson).
 * Not used at runtime for user-defined sheet models.
 */
export function materializeAwesomatixTemplateDefaultsOnField(
  field: SetupSheetModelFieldDef
): SetupSheetModelFieldDef {
  const normalized = normalizeGroupedFieldOnField(field);
  if ((normalized.groupedOptionLabels?.length ?? 0) >= 2) return normalized;

  const single = AWESOMATIX_SINGLE_CHOICE_GROUPS[field.key];
  if (single && single.length >= 2) {
    return normalizeGroupedFieldOnField({
      ...field,
      uiType: "select",
      valueType: "enum",
      groupedOptionLabels: [...single],
      groupBehaviorType: "singleSelect",
    });
  }

  const multi = AWESOMATIX_MULTI_SELECT_GROUPS[field.key];
  if (multi && multi.length >= 2) {
    return normalizeGroupedFieldOnField({
      ...field,
      uiType: "multiSelect",
      valueType: "multi",
      groupedOptionLabels: [...multi],
      groupBehaviorType: "visualMulti",
    });
  }

  return normalized;
}

/** @deprecated Use normalizeGroupedFieldOnField — no catalog injection. */
export const enrichGroupedOptionsOnField = normalizeGroupedFieldOnField;

/** @deprecated Use normalizeSetupSheetModelSchemaFields. */
export const enrichSetupSheetModelSchemaFields = normalizeSetupSheetModelSchemaFields;
