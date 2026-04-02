/**
 * Global calibration field taxonomy: deterministic field types, setup vs document metadata,
 * and single-select option lists. Extends the A800RR template catalog with additional keys.
 */

import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { buildCatalogFromTemplate, type SetupFieldMeta } from "@/lib/setupFieldCatalog";
import { isPresetWithOtherFieldKey } from "@/lib/setup/presetWithOther";
import {
  AWESOMATIX_MULTI_SELECT_GROUPS,
  AWESOMATIX_SINGLE_CHOICE_GROUPS,
  awesomatixGroupKind,
} from "@/lib/setupDocuments/awesomatixWidgetGroups";

/** Logical calibration field kinds (storage + editor behavior). */
export type CalibrationFieldKind =
  | "text"
  | "number"
  | "boolean"
  | "singleSelect"
  | "paired"
  | "visualMulti"
  | "documentMetadata";

export type CalibrationFieldCategory = "setup" | "document";

/** Extra single-select options not (yet) in awesomatixWidgetGroups. */
const EXTRA_SINGLE_SELECT_OPTIONS: Record<string, readonly string[]> = {
  winglet: ["yes", "no"],
  front_body_post_oring: ["yes", "no"],
  diff_height_front: ["Down", "Up", "+1"],
  diff_height_rear: ["Down", "Up", "+1"],
};

/** Keys that are document/header metadata, not car setup parameters. */
const DOCUMENT_METADATA_KEYS = new Set<string>([
  "name",
  "race",
  "track",
  "country",
  "date",
  "air_temp",
  "track_temp",
  "class",
]);

/**
 * Explicit field types for known keys. Keys not listed are inferred from Awesomatix group
 * helpers or default to `text`.
 */
const FIELD_TYPE_BY_KEY: Record<string, CalibrationFieldKind> = {
  // singleSelect (Awesomatix + conditions)
  chassis: "singleSelect",
  front_bumper: "singleSelect",
  top_deck_front: "singleSelect",
  top_deck_rear: "singleSelect",
  top_deck_single: "singleSelect",
  /** Separate PDF text widgets map here; merged into preset+object on the base key at snapshot time. */
  top_deck_front_other: "text",
  top_deck_rear_other: "text",
  top_deck_single_other: "text",
  chassis_other: "text",
  front_bumper_other: "text",
  srs_arrangement_front: "singleSelect",
  srs_arrangement_rear: "singleSelect",
  spring_front: "singleSelect",
  spring_rear: "singleSelect",
  pss_percent_setup_front: "singleSelect",
  pss_percent_setup_rear: "singleSelect",
  c45_installed_front: "singleSelect",
  c45_installed_rear: "singleSelect",
  damping_front: "singleSelect",
  damping_rear: "singleSelect",
  bodyshell: "singleSelect",
  wing: "singleSelect",
  track_surface: "singleSelect",
  track_layout: "visualMulti",
  traction: "visualMulti",
  front_spring_rate_gf_mm: "number",
  rear_spring_rate_gf_mm: "number",
  final_drive_ratio: "number",
  winglet: "singleSelect",
  front_body_post_oring: "singleSelect",
  tires: "text",

  // visual multi
  motor_mount_screws: "visualMulti",
  top_deck_screws: "visualMulti",
  top_deck_cuts: "visualMulti",

  // document metadata
  name: "documentMetadata",
  race: "documentMetadata",
  track: "documentMetadata",
  country: "documentMetadata",
  date: "documentMetadata",
  air_temp: "documentMetadata",
  track_temp: "documentMetadata",
  class: "documentMetadata",
};

/** Paired front/rear groups (canonical keys stay separate in snapshots; innerKind is per-side behavior). */
export const CALIBRATION_PAIR_GROUPS: Array<{
  id: string;
  label: string;
  frontKey: string;
  rearKey: string;
  innerKind: Exclude<CalibrationFieldKind, "paired" | "documentMetadata" | "visualMulti">;
}> = [
  { id: "st205", label: "ST205", frontKey: "st205_front", rearKey: "st205_rear", innerKind: "boolean" },
  { id: "st05_r", label: "ST05-R", frontKey: "st05_r_front", rearKey: "st05_r_rear", innerKind: "boolean" },
  { id: "bw22r", label: "BW22R", frontKey: "bw22r_front", rearKey: "bw22r_rear", innerKind: "boolean" },
  { id: "bw52r", label: "BW52R", frontKey: "bw52r_front", rearKey: "bw52r_rear", innerKind: "boolean" },
  { id: "abh", label: "ABH", frontKey: "abh_front", rearKey: "abh_rear", innerKind: "boolean" },
  { id: "c26", label: "C26", frontKey: "c26_front", rearKey: "c26_rear", innerKind: "boolean" },
  { id: "at15", label: "AT15", frontKey: "at15_front", rearKey: "at15_rear", innerKind: "boolean" },
  { id: "at13w", label: "AT13W", frontKey: "at13w_front", rearKey: "at13w_rear", innerKind: "boolean" },
  { id: "wheel_spacer", label: "Wheel spacer", frontKey: "wheel_spacer_front", rearKey: "wheel_spacer_rear", innerKind: "number" },
  { id: "diff_height", label: "Diff height", frontKey: "diff_height_front", rearKey: "diff_height_rear", innerKind: "singleSelect" },
  { id: "lower_arm_extension", label: "Lower arm extension", frontKey: "lower_arm_extension_front", rearKey: "lower_arm_extension_rear", innerKind: "number" },
  { id: "side_wall_glue", label: "Side wall glue", frontKey: "side_wall_glue_front", rearKey: "side_wall_glue_rear", innerKind: "text" },
];

for (const g of CALIBRATION_PAIR_GROUPS) {
  FIELD_TYPE_BY_KEY[g.frontKey] = g.innerKind;
  FIELD_TYPE_BY_KEY[g.rearKey] = g.innerKind;
}

export function getPairGroupForKey(key: string): (typeof CALIBRATION_PAIR_GROUPS)[number] | null {
  return CALIBRATION_PAIR_GROUPS.find((g) => g.frontKey === key || g.rearKey === key) ?? null;
}

/** UI / docs: front/rear members of a pair use logical type `paired`; mapping uses inner kind per key. */
export function getLogicalFieldKind(key: string): CalibrationFieldKind {
  if (getPairGroupForKey(key)) return "paired";
  return getCalibrationFieldKind(key);
}

/** Supplemental catalog rows (not yet on structured A800RR sheet layout). */
const SUPPLEMENTAL_CALIBRATION_FIELDS: SetupFieldMeta[] = [
  { key: "track_layout", label: "Track layout", groupId: "event", groupTitle: "Event & track" },
  { key: "track_surface", label: "Track surface", groupId: "event", groupTitle: "Event & track" },
  { key: "traction", label: "Traction", groupId: "event", groupTitle: "Event & track" },
  { key: "final_drive_ratio", label: "Final drive ratio", groupId: "drivetrain", groupTitle: "Drivetrain & hardware" },
  { key: "bodyshell_upstop_height", label: "Bodyshell upstop height", groupId: "general", groupTitle: "General / car-wide" },
  { key: "rear_hrb_setting", label: "Rear HRB setting", groupId: "general", groupTitle: "General / car-wide" },
  { key: "front_body_post_hole", label: "Front body post hole", groupId: "general", groupTitle: "General / car-wide" },
  { key: "body_position_from_windshield", label: "Body position from windshield", groupId: "general", groupTitle: "General / car-wide" },
  { key: "motor_lateral_shift", label: "Motor lateral shift", groupId: "drivetrain", groupTitle: "Drivetrain & hardware" },
  { key: "servo", label: "Servo", groupId: "electronics", groupTitle: "Electronics" },
  { key: "motor", label: "Motor", groupId: "drivetrain", groupTitle: "Drivetrain & hardware" },
  { key: "spur", label: "Spur", groupId: "drivetrain", groupTitle: "Drivetrain & hardware" },
  { key: "pinion", label: "Pinion", groupId: "drivetrain", groupTitle: "Drivetrain & hardware" },
  { key: "esc", label: "ESC", groupId: "electronics", groupTitle: "Electronics" },
  { key: "radio", label: "Radio", groupId: "electronics", groupTitle: "Electronics" },
  { key: "receiver", label: "Receiver", groupId: "electronics", groupTitle: "Electronics" },
  { key: "steer_travel_out", label: "Steer travel out", groupId: "geometry_suspension", groupTitle: "Geometry / shims / suspension" },
  { key: "ackermann_position", label: "Ackermann position", groupId: "geometry_suspension", groupTitle: "Geometry / shims / suspension" },
  { key: "servo_horn_height", label: "Servo horn height", groupId: "electronics", groupTitle: "Electronics" },
  { key: "additive", label: "Additive", groupId: "general", groupTitle: "General / car-wide" },
  { key: "additive_time", label: "Additive time", groupId: "general", groupTitle: "General / car-wide" },
  { key: "winglet", label: "Winglet", groupId: "general", groupTitle: "General / car-wide" },
  { key: "front_body_post_oring", label: "Front body post O-ring", groupId: "general", groupTitle: "General / car-wide" },
  { key: "name", label: "Name", groupId: "metadata", groupTitle: "Document / header" },
  { key: "race", label: "Race", groupId: "metadata", groupTitle: "Document / header" },
  { key: "track", label: "Track", groupId: "metadata", groupTitle: "Document / header" },
  { key: "country", label: "Country", groupId: "metadata", groupTitle: "Document / header" },
  { key: "date", label: "Date", groupId: "metadata", groupTitle: "Document / header" },
  { key: "air_temp", label: "Air temp", groupId: "metadata", groupTitle: "Document / header" },
  { key: "track_temp", label: "Track temp", groupId: "metadata", groupTitle: "Document / header" },
  { key: "class", label: "Class", groupId: "metadata", groupTitle: "Document / header" },
  /** Preset+other: calibrate the free-text AcroForm separately from checkbox options (same section as parent fields). */
  { key: "chassis_other", label: "Chassis · custom text", groupId: "general", groupTitle: "General / car-wide" },
  { key: "front_bumper_other", label: "Front bumper · custom text", groupId: "general", groupTitle: "General / car-wide" },
  { key: "top_deck_front_other", label: "Top deck · Front · custom text", groupId: "general", groupTitle: "General / car-wide" },
  { key: "top_deck_rear_other", label: "Top deck · Rear · custom text", groupId: "general", groupTitle: "General / car-wide" },
  { key: "top_deck_single_other", label: "Top deck · Single · custom text", groupId: "general", groupTitle: "General / car-wide" },
  ...CALIBRATION_PAIR_GROUPS.flatMap((g) => [
    { key: g.frontKey, label: `${g.label} · Front`, groupId: "general", groupTitle: "General / car-wide" },
    { key: g.rearKey, label: `${g.label} · Rear`, groupId: "general", groupTitle: "General / car-wide" },
  ]),
];

function inferFieldType(key: string): CalibrationFieldKind {
  const explicit = FIELD_TYPE_BY_KEY[key];
  if (explicit) return explicit;
  const gk = awesomatixGroupKind(key);
  if (gk === "single") return "singleSelect";
  if (gk === "multi") return "visualMulti";
  if (DOCUMENT_METADATA_KEYS.has(key)) return "documentMetadata";
  return "text";
}

export function getCalibrationFieldKind(key: string): CalibrationFieldKind {
  return inferFieldType(key);
}

export function isDocumentMetadataField(key: string): boolean {
  return inferFieldType(key) === "documentMetadata" || DOCUMENT_METADATA_KEYS.has(key);
}

export function getCalibrationFieldCategory(key: string): CalibrationFieldCategory {
  return isDocumentMetadataField(key) ? "document" : "setup";
}

/**
 * Options shown as blue chips: pick option → click PDF widget. Same workflow as chassis.
 * Returns null if this key does not use the chip + PDF flow.
 */
export function getSingleSelectChipOptions(key: string): string[] | null {
  if (inferFieldType(key) !== "singleSelect") return null;
  const aw = AWESOMATIX_SINGLE_CHOICE_GROUPS[key as keyof typeof AWESOMATIX_SINGLE_CHOICE_GROUPS];
  if (aw) {
    const list = [...aw];
    /** Preset + free-text fields: "Other" is not a chip — use the separate text box only. */
    return isPresetWithOtherFieldKey(key) ? list.filter((o) => !optionLabelIsOther(o)) : list;
  }
  const ex = EXTRA_SINGLE_SELECT_OPTIONS[key];
  if (ex) return [...ex];
  return null;
}

function optionLabelIsOther(label: string): boolean {
  return label.trim().toLowerCase().replace(/\s+/g, " ") === "other";
}

/**
 * Companion free-text key for single-select fields whose option list includes "Other".
 * Convention: `{baseKey}_other` holds free text; the preset token stays on `baseKey`.
 */
export function companionOtherTextKeyForSingleSelect(baseKey: string): string | null {
  /** Preset + otherText live on one object on `baseKey`; no separate `*_other` key. */
  if (isPresetWithOtherFieldKey(baseKey)) return null;
  const opts = getSingleSelectChipOptions(baseKey);
  if (!opts || opts.length === 0 || !opts.some(optionLabelIsOther)) return null;
  return `${baseKey}_other`;
}

/** True if key uses chip (option) then PDF click workflow. */
export function usesSingleSelectChipWorkflow(key: string): boolean {
  const opts = getSingleSelectChipOptions(key);
  return opts != null && opts.length > 0;
}

export function getVisualMultiOptions(key: string): string[] | null {
  if (inferFieldType(key) !== "visualMulti") return null;
  const m = AWESOMATIX_MULTI_SELECT_GROUPS[key as keyof typeof AWESOMATIX_MULTI_SELECT_GROUPS];
  return m ? [...m] : [];
}

/**
 * Extended catalog: A800RR structured template + supplemental keys for calibration/editor.
 */
export function buildCalibrationFieldCatalog(): SetupFieldMeta[] {
  const base = buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1);
  const seen = new Set(base.map((f) => f.key));
  const merged: SetupFieldMeta[] = [...base];
  for (const f of SUPPLEMENTAL_CALIBRATION_FIELDS) {
    if (!seen.has(f.key)) {
      seen.add(f.key);
      merged.push(f);
    }
  }
  merged.sort((a, b) => {
    const ga = a.groupTitle.localeCompare(b.groupTitle);
    if (ga !== 0) return ga;
    return a.label.localeCompare(b.label);
  });
  return merged;
}
