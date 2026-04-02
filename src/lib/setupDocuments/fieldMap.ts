import type { CustomSetupFieldDefinition } from "@/lib/setupCalibrations/types";
import { buildMergedLabelMap, mergeCustomFieldsIntoCatalog } from "@/lib/setupCalibrations/customFieldCatalog";
import { buildCalibrationFieldCatalog } from "@/lib/setupCalibrations/calibrationFieldCatalog";

/** Global calibration catalog: A800RR template + supplemental keys (track, drivetrain, metadata, pairs). */
export const A800RR_FIELD_CATALOG = buildCalibrationFieldCatalog().filter(
  (f) => f.key !== "notes" && f.key !== "tires_setup"
);

export const A800RR_FIELD_LABEL_MAP: Record<string, string> = Object.fromEntries(
  A800RR_FIELD_CATALOG.map((f) => [f.key, f.label])
);

/** Base A800RR catalog merged with user-defined fields from a calibration profile. */
export function getEffectiveFieldCatalog(custom?: CustomSetupFieldDefinition[]) {
  return mergeCustomFieldsIntoCatalog(A800RR_FIELD_CATALOG, custom ?? []);
}

export function getEffectiveFieldLabelMap(custom?: CustomSetupFieldDefinition[]) {
  return buildMergedLabelMap(custom ?? []);
}

