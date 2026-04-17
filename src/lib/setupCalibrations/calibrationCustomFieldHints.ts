import type { GroupedFieldBehaviorType, SetupFieldDomain } from "@/lib/setupCalibrations/types";

/** Recipe ids for quick defaults in the calibration field form (non-template). */
export type CalibrationFieldRecipeId =
  | "setup_text"
  | "setup_textarea"
  | "setup_number"
  | "checkbox_toggle"
  | "document_meta"
  | "event_track_meta";

export type CalibrationFieldRecipeApply = {
  cfFieldDomain: SetupFieldDomain;
  setCfFieldDomain: (v: SetupFieldDomain) => void;
  cfIsMetadata: boolean;
  setCfIsMetadata: (v: boolean) => void;
  cfUiType: import("@/lib/setupCalibrations/types").CustomFieldUiType;
  setCfUiType: (v: import("@/lib/setupCalibrations/types").CustomFieldUiType) => void;
  cfValueType: import("@/lib/setupCalibrations/types").CustomFieldValueType;
  setCfValueType: (v: import("@/lib/setupCalibrations/types").CustomFieldValueType) => void;
  cfSectionId: string;
  setCfSectionId: (v: string) => void;
};

/**
 * Applies a one-click “recipe” for common calibration field shapes.
 * Does not change key/label/grouped behavior (those stay user-driven).
 */
export function applyCalibrationFieldRecipe(
  recipe: CalibrationFieldRecipeId,
  p: CalibrationFieldRecipeApply
): void {
  switch (recipe) {
    case "setup_text":
      p.setCfFieldDomain("setup");
      p.setCfIsMetadata(false);
      p.setCfUiType("text");
      p.setCfValueType("string");
      if (p.cfSectionId === "document" || p.cfSectionId === "metadata") p.setCfSectionId("tuning");
      break;
    case "setup_textarea":
      p.setCfFieldDomain("setup");
      p.setCfIsMetadata(false);
      p.setCfUiType("textarea");
      p.setCfValueType("string");
      if (p.cfSectionId === "document" || p.cfSectionId === "metadata") p.setCfSectionId("tuning");
      break;
    case "setup_number":
      p.setCfFieldDomain("setup");
      p.setCfIsMetadata(false);
      p.setCfUiType("text");
      p.setCfValueType("number");
      if (p.cfSectionId === "document" || p.cfSectionId === "metadata") p.setCfSectionId("tuning");
      break;
    case "checkbox_toggle":
      p.setCfFieldDomain("setup");
      p.setCfIsMetadata(false);
      p.setCfUiType("checkbox");
      p.setCfValueType("boolean");
      if (p.cfSectionId === "document" || p.cfSectionId === "metadata") p.setCfSectionId("tuning");
      break;
    case "document_meta":
      p.setCfFieldDomain("document");
      p.setCfIsMetadata(true);
      p.setCfUiType("text");
      p.setCfValueType("string");
      p.setCfSectionId("document");
      break;
    case "event_track_meta":
      p.setCfFieldDomain("metadata");
      p.setCfIsMetadata(true);
      p.setCfUiType("text");
      p.setCfValueType("string");
      p.setCfSectionId("event");
      break;
    default:
      break;
  }
}

/** Single new field from one PDF Acro name — section + domain defaults. */
export function inferSectionAndDomainForNewCustomField(pdfFieldName: string): {
  sectionId: string;
  fieldDomain: SetupFieldDomain;
  isMetadata: boolean;
} {
  const n = pdfFieldName.toLowerCase();
  if (/driver|entrant|\bname\b|club|license|transponder/i.test(n)) {
    return { sectionId: "metadata", fieldDomain: "metadata", isMetadata: true };
  }
  if (/\bdate\b|datum|day|round|heat|final|qual/i.test(n)) {
    return { sectionId: "document", fieldDomain: "document", isMetadata: true };
  }
  if (/track|layout|venue|location|surface|grip|condition|weather/i.test(n)) {
    return { sectionId: "event", fieldDomain: "metadata", isMetadata: true };
  }
  if (
    /motor|mount|deck|cut|screw|stiff|flex|c45|chassis|bodyshell|bumper|wing|battery|weight|gear|ratio|pinion|spur|belt|pulley/i.test(
      n
    )
  ) {
    return { sectionId: "flex", fieldDomain: "setup", isMetadata: false };
  }
  if (/oil|grease|diff|shock|damper|spring|roll|toe|camber|caster|ride|geometry|arm|hub|link/i.test(n)) {
    return { sectionId: "geometry_suspension", fieldDomain: "setup", isMetadata: false };
  }
  if (/\besc\b|\bmotor\b|\breceiver\b|\bservo\b|\btx\b|\brx\b|fdr|timing/i.test(n)) {
    return { sectionId: "electronics", fieldDomain: "setup", isMetadata: false };
  }
  return { sectionId: "platform_chassis", fieldDomain: "setup", isMetadata: false };
}

/** Multi-widget grouped field — behavior + section defaults from PDF names. */
export function inferGroupedFieldDefaultsFromPdfNames(fieldNames: string[]): {
  groupBehaviorType: GroupedFieldBehaviorType;
  sectionId: string;
  fieldDomain: SetupFieldDomain;
  isMetadata: boolean;
  labelSuggestion: string;
} {
  const joined = fieldNames.join(" ").toLowerCase();
  const screwLike = /screw|mount|strip|post|hole|position|mm\d|m\d/i.test(joined);
  const cutDeckLike = /cut|deck|td_|topdeck|technical|standard|full|open|stiff/i.test(joined);
  if (screwLike && !/\bcut\b|deck\s*cut|top\s*cut/i.test(joined)) {
    return {
      groupBehaviorType: "visualMulti",
      sectionId: "flex",
      fieldDomain: "setup",
      isMetadata: false,
      labelSuggestion: "Screw / position selection",
    };
  }
  if (cutDeckLike || /bumper|chassis|body|stiffener|brace/i.test(joined)) {
    return {
      groupBehaviorType: "singleSelect",
      sectionId: "flex",
      fieldDomain: "setup",
      isMetadata: false,
      labelSuggestion: "Configuration (single choice)",
    };
  }
  return {
    groupBehaviorType: "singleSelect",
    sectionId: "tuning",
    fieldDomain: "setup",
    isMetadata: false,
    labelSuggestion: "Grouped setup value",
  };
}
