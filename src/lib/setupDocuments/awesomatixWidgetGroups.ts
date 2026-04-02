/**
 * Awesomatix A800RR-style editable PDF: grouped checkbox/radio widgets often share one AcroForm field name.
 * Calibration maps each *widget instance* (stable index per field) to an option label, then import reads /AS per widget.
 */

export type AwesomatixGroupKind = "single" | "multi";

export const AWESOMATIX_SINGLE_CHOICE_GROUPS: Record<string, readonly string[]> = {
  srs_arrangement_front: ["I", "II"],
  srs_arrangement_rear: ["I", "II"],
  spring_front: ["STD", "S"],
  spring_rear: ["STD", "S"],
  /** PSS row (30 / 25 / 15) — not the damper % dial (60–100). */
  pss_percent_setup_front: ["30", "25", "15"],
  pss_percent_setup_rear: ["30", "25", "15"],
  c45_installed_front: ["Yes", "No"],
  c45_installed_rear: ["Yes", "No"],
  /** Drive / diff height row */
  diff_height: ["Down", "Up", "+1"],
  damping_front: ["Linear", "P1", "P2"],
  damping_rear: ["Linear", "P1", "P2"],
  /** PDF may include an "Other" widget; setup review chips omit it — free text is a separate field. */
  chassis: ["C01B-RAF", "C01B-RC", "C01RS", "Other"],
  front_bumper: ["C07R", "C07RF", "Other"],
  top_deck_front: ["C127S", "C127", "Other"],
  top_deck_rear: ["C127S", "C127", "Other"],
  top_deck_single: ["C27MMX", "Other"],
  /** Event / conditions single-choice */
  track_surface: ["asphalt", "carpet"],
};

export const AWESOMATIX_MULTI_SELECT_GROUPS: Record<string, readonly string[]> = {
  top_deck_screws: ["A", "B", "C", "D", "E", "F"],
  /** Eight cut positions; same click workflow as top deck screws. */
  top_deck_cuts: ["A", "B", "C", "D", "E", "F", "G", "H"],
  motor_mount_screws: ["1", "2", "3", "4", "5"],
  /** Event / conditions can have multiple checks on some sheets (e.g. Lauter). */
  track_layout: ["technical", "mixed", "fast"],
  traction: ["low", "medium", "high"],
};

export function awesomatixGroupKind(appKey: string): AwesomatixGroupKind | null {
  if (appKey in AWESOMATIX_SINGLE_CHOICE_GROUPS) return "single";
  if (appKey in AWESOMATIX_MULTI_SELECT_GROUPS) return "multi";
  return null;
}

export function awesomatixGroupOptions(appKey: string): readonly string[] | null {
  return AWESOMATIX_SINGLE_CHOICE_GROUPS[appKey] ?? AWESOMATIX_MULTI_SELECT_GROUPS[appKey] ?? null;
}
