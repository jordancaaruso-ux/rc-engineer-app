import type { SetupSheetModelSchema, SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";
import type { ExtractionSchema, ExtractionFieldDef } from "@/lib/setupExtractAi/types";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";

/**
 * Bridge: a car's SetupSheetModel schema → the extraction schema the vision reader targets.
 * This is what makes AI extraction produce app-native field keys (so values slot straight
 * into a setup snapshot) instead of the ad-hoc keys used by the eval gold set.
 *
 * Pure (no server-only) so it's unit-testable and usable from the eval harness.
 */

function isChoiceField(f: SetupSheetModelFieldDef): boolean {
  if (f.groupedOptionLabels?.length || f.groupedOptionValues?.length) return true;
  if (f.valueType === "enum" || f.valueType === "multi") return true;
  if (f.uiType === "select" || f.uiType === "multiSelect" || f.uiType === "groupOption") return true;
  if (f.uiType === "checkbox" || f.valueType === "boolean") return true;
  return false;
}

/** Options the reader may return — visible sheet labels preferred, canonical values as fallback. */
function choiceOptions(f: SetupSheetModelFieldDef): string[] {
  const labels = (f.groupedOptionLabels ?? []).map((s) => s.trim()).filter(Boolean);
  if (labels.length) return labels;
  const values = (f.groupedOptionValues ?? []).map((s) => s.trim()).filter(Boolean);
  if (values.length) return values;
  // Lone checkbox / boolean with no explicit options → yes/no presence.
  if (f.uiType === "checkbox" || f.valueType === "boolean") return ["yes", "no"];
  return [];
}

function labelWithUnit(f: SetupSheetModelFieldDef): string {
  const base = f.displayLabel?.trim() || f.key;
  return f.unit ? `${base} (${f.unit})` : base;
}

export function buildExtractionSchemaFromModel(input: {
  model: SetupSheetModelSchema;
  /** Only fields visible on the full setup sheet are worth extracting; defaults to true. */
  setupSheetFieldsOnly?: boolean;
}): ExtractionSchema {
  const onlySheet = input.setupSheetFieldsOnly ?? true;
  const fields: ExtractionFieldDef[] = [];
  const seen = new Set<string>();

  const ordered = [...input.model.fields].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const f of ordered) {
    if (!f.key || seen.has(f.key)) continue;
    if (onlySheet && f.showInSetupSheet === false) continue;
    seen.add(f.key);
    const choice = isChoiceField(f);
    const options = choice ? choiceOptions(f) : [];
    // Keep the cross-car aggregation key aligned: trust the model's own mapping, else infer
    // from the key/label so even sheets that never declared one still pool correctly.
    const universalParameterId =
      f.universalParameterId?.trim() || suggestUniversalParameterId(f.key, f.displayLabel);
    fields.push({
      key: f.key,
      label: labelWithUnit(f),
      section: f.sectionTitle?.trim() || f.sectionId || "",
      // A "choice" field with no resolvable options can't constrain the reader — treat as text.
      valueType: choice && options.length > 0 ? "choice" : "text",
      ...(choice && options.length > 0 ? { options } : {}),
      ...(universalParameterId ? { universalParameterId } : {}),
    });
  }

  return {
    version: 1,
    label: input.model.label?.trim() || "Setup sheet",
    fields,
  };
}
