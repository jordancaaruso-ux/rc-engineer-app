import type { CustomSetupFieldDefinition } from "@/lib/setupCalibrations/types";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/** Seed calibration `customFieldDefinitions` from a setup sheet model schema (wizard + mapping). */
export function customFieldDefinitionsFromModelSchema(
  schema: SetupSheetModelSchema
): CustomSetupFieldDefinition[] {
  return schema.fields.map((f, idx) => ({
    id: `model_${f.key}`,
    key: f.key,
    displayLabel: f.displayLabel,
    sectionId: f.sectionId,
    sectionTitle: f.sectionTitle,
    fieldDomain: f.sectionId === "session" ? "metadata" : "setup",
    valueType: f.valueType,
    uiType: f.uiType,
    isMetadata: f.sectionId === "session",
    showInSetupSheet: f.showInSetupSheet,
    showInAnalysis: f.showInAnalysis,
    isPdfExportable: true,
    sortOrder: f.sortOrder ?? idx,
    unit: f.unit,
    ...(f.groupBehaviorType ? { groupBehaviorType: f.groupBehaviorType } : {}),
  }));
}
