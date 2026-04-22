/**
 * Keys used for Engineer setup comparisons vs spread / run-to-run deltas.
 * Excludes motor, pinion, wing, electronics, etc. (see openaiEngineer + UI run compare stays full-detail).
 */

const EXACT_TUNING_KEYS = new Set<string>([
  // Upper / lower / outer shims
  "upper_inner_shims_ff",
  "upper_inner_shims_fr",
  "upper_inner_shims_rf",
  "upper_inner_shims_rr",
  "under_lower_arm_shims_ff",
  "under_lower_arm_shims_fr",
  "under_lower_arm_shims_rf",
  "under_lower_arm_shims_rr",
  "upper_outer_shims_front",
  "upper_outer_shims_rear",
  "bump_steer_shims_front",
  "toe_gain_shims_rear",
  "under_hub_shims_front",
  "under_hub_shims_rear",
  /** Shim-derived link indices mm (see setupGeometryDerivedMetrics). */
  "derived_upper_link_index_front_mm",
  "derived_upper_link_index_rear_mm",
  "derived_upper_link_stagger_mm",
  "derived_lower_link_index_front_mm",
  "derived_lower_link_index_rear_mm",
  "derived_lower_link_stagger_mm",
  // Fluids / springs (explicit)
  "diff_oil",
  "front_spring_rate_gf_mm",
  "rear_spring_rate_gf_mm",
  // Mass / layout
  "weight_balance_front_percent",
  "chassis",
  "front_bumper",
  // Catalog extras
  "ackermann_position",
  "rear_hrb_setting",
  "body_position_from_windshield",
  "bodyshell_upstop_height",
  "inner_steering_angle",
  "motor_lateral_shift",
  "servo_horn_height",
  "side_wall_glue_front",
  "side_wall_glue_rear",
  // C45 / deck / motor mount
  "c45_installed_front",
  "c45_installed_rear",
  "motor_mount_screws",
  "top_deck_screws",
  "top_deck_cuts",
]);

/** Prefixes for geometry, dampers, PSS, roll bars, diff height, etc. */
const TUNING_KEY_PREFIXES: readonly string[] = [
  "camber_",
  "caster_",
  "toe_",
  "ride_height_",
  "droop_",
  "downstop_",
  "upstop_",
  "arb_",
  "diff_height_",
  "damper_oil_",
  "damper_percent_",
  "pss_percent_setup_",
  "damping_",
  /** Spring type / gap rows on A800RR sheet (e.g. spring_front, spring_gap_rear). */
  "spring_",
];

export function isTuningComparisonKey(key: string): boolean {
  if (EXACT_TUNING_KEYS.has(key)) return true;
  return TUNING_KEY_PREFIXES.some((p) => key.startsWith(p));
}
