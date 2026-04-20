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

/**
 * Generic touring-car style sheet — rendered via `structuredSections` so the
 * Front/Rear axes share a single `| Parameter | Front | Rear |` column header
 * instead of duplicating "Front" / "Rear" labels inside every cell block.
 *
 * `groups` is kept (duplicating the fields) so non-structured consumers
 * (PDF export, catalog metadata, older importers) still see the full set of
 * keys if they read from `template.groups`.
 */
export const GENERIC_SETUP_SHEET_V1: SetupSheetTemplate = {
  id: "generic-v1",
  label: "Generic touring",
  structuredSections: [
    {
      id: "suspension",
      title: "Suspension (Front / Rear)",
      rows: [
        { type: "pair", label: "Camber", unit: "°", leftKey: "camber_front", rightKey: "camber_rear" },
        { type: "pair", label: "Toe", unit: "°", leftKey: "toe_front", rightKey: "toe_rear" },
        { type: "pair", label: "Ride Ht", unit: "mm", leftKey: "ride_height_front", rightKey: "ride_height_rear" },
        { type: "pair", label: "Droop", unit: "mm", leftKey: "droop_front", rightKey: "droop_rear" },
        { type: "pair", label: "Spring", leftKey: "spring_front", rightKey: "spring_rear" },
        { type: "pair", label: "Oil / damper", unit: "cSt", leftKey: "shock_oil_front", rightKey: "shock_oil_rear" },
        { type: "pair", label: "Roll bar", leftKey: "arb_front", rightKey: "arb_rear" },
        { type: "pair", label: "Roll ctr", leftKey: "roll_center_front", rightKey: "roll_center_rear" },
      ],
    },
    {
      id: "drivetrain",
      title: "Diff & drivetrain",
      rows: [
        { type: "single", key: "diff", label: "Diff / slipper" },
        {
          type: "pair",
          label: "Diff height",
          leftKey: "diff_height_front",
          rightKey: "diff_height_rear",
        },
      ],
    },
    {
      id: "tyres_body",
      title: "Tyres & body",
      rows: [
        { type: "single", key: "tires_setup", label: "Tyres / compound", multiline: true },
        { type: "single", key: "body_notes", label: "Body / aero notes", multiline: true },
      ],
    },
  ],
  groups: [
    {
      id: "suspension",
      title: "Suspension",
      column: "full",
      fields: [
        { key: "camber_front", label: "Camber (Front)", unit: "°" },
        { key: "camber_rear", label: "Camber (Rear)", unit: "°" },
        { key: "toe_front", label: "Toe (Front)", unit: "°" },
        { key: "toe_rear", label: "Toe (Rear)", unit: "°" },
        { key: "ride_height_front", label: "Ride Ht (Front)", unit: "mm" },
        { key: "ride_height_rear", label: "Ride Ht (Rear)", unit: "mm" },
        { key: "droop_front", label: "Droop (Front)", unit: "mm" },
        { key: "droop_rear", label: "Droop (Rear)", unit: "mm" },
        { key: "spring_front", label: "Spring (Front)" },
        { key: "spring_rear", label: "Spring (Rear)" },
        { key: "shock_oil_front", label: "Oil / damper (Front)", unit: "cSt" },
        { key: "shock_oil_rear", label: "Oil / damper (Rear)", unit: "cSt" },
        { key: "arb_front", label: "Roll bar (Front)" },
        { key: "arb_rear", label: "Roll bar (Rear)" },
        { key: "roll_center_front", label: "Roll ctr (Front)" },
        { key: "roll_center_rear", label: "Roll ctr (Rear)" },
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
