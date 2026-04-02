/**
 * Visual setup sheet layout layer on top of structured SetupSnapshotData keys.
 * Same keys as DB snapshot; add car-specific templates later via templateId.
 */

import type { StructuredSection } from "@/lib/a800rrSetupDisplayConfig";

export type SetupSheetFieldDef = {
  key: string;
  label: string;
  unit?: string;
  /** false = display only until editing UX added */
  editable?: boolean;
  /** Optional UI control hint (defaults to text/number-ish input). */
  input?: "text" | "checkbox";
};

export type SetupSheetGroupDef = {
  id: string;
  title: string;
  /** Column hint for responsive layout */
  column?: "left" | "right" | "full";
  fields: SetupSheetFieldDef[];
};

export type SetupSheetTemplate = {
  id: string;
  label: string;
  groups: SetupSheetGroupDef[];
  /** When set (e.g. A800RR v2), SetupSheetView renders structured sections instead of legacy groups. */
  structuredSections?: StructuredSection[];
};

/** Generic touring-car style sheet; swap templateId for car-specific later. */
export const GENERIC_SETUP_SHEET_V1: SetupSheetTemplate = {
  id: "generic-v1",
  label: "Generic touring",
  groups: [
    {
      id: "front",
      title: "Front",
      column: "left",
      fields: [
        { key: "camber_front", label: "Camber", unit: "°" },
        { key: "toe_front", label: "Toe", unit: "°" },
        { key: "ride_height_front", label: "Ride Ht", unit: "mm" },
        { key: "droop_front", label: "Droop", unit: "mm" },
        { key: "spring_front", label: "Spring" },
        { key: "shock_oil_front", label: "Oil / damper", unit: "cSt" },
        { key: "arb_front", label: "Roll bar" },
        { key: "roll_center_front", label: "Roll ctr" },
      ],
    },
    {
      id: "rear",
      title: "Rear",
      column: "right",
      fields: [
        { key: "camber_rear", label: "Camber", unit: "°" },
        { key: "toe_rear", label: "Toe", unit: "°" },
        { key: "ride_height_rear", label: "Ride Ht", unit: "mm" },
        { key: "droop_rear", label: "Droop", unit: "mm" },
        { key: "spring_rear", label: "Spring" },
        { key: "shock_oil_rear", label: "Oil / damper", unit: "cSt" },
        { key: "arb_rear", label: "Roll bar" },
        { key: "roll_center_rear", label: "Roll ctr" },
      ],
    },
    {
      id: "drivetrain",
      title: "Diff & drivetrain",
      column: "full",
      fields: [
        { key: "diff", label: "Diff / slipper" },
        { key: "diff_height_front", label: "Diff height (Front)" },
        { key: "diff_height_rear", label: "Diff height (Rear)" },
      ],
    },
    {
      id: "tyres_body",
      title: "Tyres & body",
      column: "full",
      fields: [
        { key: "tires_setup", label: "Tyres / compound" },
        { key: "body_notes", label: "Body / aero notes" },
      ],
    },
  ],
};

export function getDefaultSetupSheetTemplate(): SetupSheetTemplate {
  return GENERIC_SETUP_SHEET_V1;
}
