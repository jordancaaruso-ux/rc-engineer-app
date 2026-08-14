/**
 * Printed boxes on the Awesomatix A800RR sheet that its calibration never mapped, because the
 * import path COMPUTES their values rather than reading them.
 *
 * The calibration is the record of what a human named for the Engineer to understand; these four
 * are real boxes on the paper with real schema keys that simply never needed a read rule. Without
 * them the sheet shows those rows blank forever and an export leaves them empty, which is why they
 * are supplied to both `boxesFromCalibrationMappings` (to draw them) and the union pass (so it does
 * not mint a SECOND parameter over the same box).
 *
 * Confirmed against Jordan's own filled sheet 2026-08-11: Text91/Text93 held the computed spring
 * rates, `ratio` held 4.318, Text17 held his to-test notes.
 */
export const A800RR_EXTRA_SIMPLE_KEYS: Record<string, string> = {
  front_spring_rate_gf_mm: "Text91",
  rear_spring_rate_gf_mm: "Text93",
  final_drive_ratio: "ratio",
  notes: "Text17",
};
