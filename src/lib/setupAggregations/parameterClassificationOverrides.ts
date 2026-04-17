/**
 * Manual overrides for aggregation classification (numeric vs categorical).
 *
 * Why this exists
 * ---------------
 * The rebuild pipeline normally infers classification per key from the data:
 *   - every sample parses as a finite number -> NUMERIC
 *   - otherwise                              -> CATEGORICAL
 *
 * That's fragile for ordinal-looking numeric fields (ARB 1.1 / 1.2 / 1.3, spring rates,
 * damper oil weights, etc.) because a single bad sample (e.g. "No ARB", "1.1 TS",
 * stray label text) will demote the whole key to CATEGORICAL and you lose the numeric
 * distribution. It's equally fragile for binary/presence indicators whose value is
 * always "1": those get auto-classified NUMERIC but you actually want a frequency.
 *
 * How this overrides the default
 * ------------------------------
 *   - "numeric":     force NUMERIC. Non-numeric samples are DROPPED instead of
 *                    demoting the bucket. Applied in `extractObservation` and
 *                    re-asserted in `rowsFromPerKeyMapShared`.
 *   - "categorical": force CATEGORICAL. Values are always stringified regardless
 *                    of whether they look numeric.
 *
 * Keys NOT in this map fall back to the inferred classification.
 */
export type ParameterClassificationOverride = "numeric" | "categorical";

export const PARAMETER_CLASSIFICATION_OVERRIDES: Record<string, ParameterClassificationOverride> = {
  // --- ARB (original seed) ---
  arb_front: "numeric",
  arb_rear: "numeric",

  // --- Upgrade candidates: CATEGORICAL -> NUMERIC ---
  additive_time: "numeric",
  air_temp: "numeric",
  motor_lateral_shift: "numeric",
  side_wall_glue_front: "numeric",
  side_wall_glue_rear: "numeric",
  steer_travel_out: "numeric",
  total_weight: "numeric",
  under_hub_shims_front: "numeric",
  under_hub_shims_rear: "numeric",
  upstop_front: "numeric",
  upstop_rear: "numeric",
  wheel_spacer_front: "numeric",
  wheel_spacer_rear: "numeric",

  // --- Upgrade candidates: CATEGORICAL stays CATEGORICAL (locked) ---
  chassis: "categorical",
  damping_front: "categorical",
  front_bumper: "categorical",

  // --- MIXED (asphalt vs carpet inconsistency) -> NUMERIC ---
  bodyshell_upstop_height: "numeric",
  damper_oil_front: "numeric",
  downstop_front: "numeric",
  downstop_rear: "numeric",
  servo_horn_height: "numeric",
  weight_balance_front_percent: "numeric",

  // --- MIXED -> CATEGORICAL ---
  front_body_post_hole: "categorical",

  // --- Already NUMERIC, locked (protects against future bad samples) ---
  body_position_from_windshield: "numeric",
  bump_steer_shims_front: "numeric",
  camber_front: "numeric",
  camber_rear: "numeric",
  caster_front: "numeric",
  caster_rear: "numeric",
  damper_oil_rear: "numeric",
  damper_percent_front: "numeric",
  damper_percent_rear: "numeric",
  diff_oil: "numeric",
  final_drive_ratio: "numeric",
  front_spring_rate_gf_mm: "numeric",
  inner_steering_angle: "numeric",
  pinion: "numeric",
  rear_hrb_setting: "numeric",
  rear_spring_rate_gf_mm: "numeric",
  ride_height_front: "numeric",
  ride_height_rear: "numeric",
  spring_gap_front: "numeric",
  spring_gap_rear: "numeric",
  spur: "numeric",
  toe_front: "numeric",
  toe_gain_shims_rear: "numeric",
  toe_rear: "numeric",
  under_lower_arm_shims_ff: "numeric",
  under_lower_arm_shims_fr: "numeric",
  under_lower_arm_shims_rf: "numeric",
  under_lower_arm_shims_rr: "numeric",
  upper_inner_shims_ff: "numeric",
  upper_inner_shims_fr: "numeric",
  upper_inner_shims_rf: "numeric",
  upper_inner_shims_rr: "numeric",
  upper_outer_shims_front: "numeric",
  upper_outer_shims_rear: "numeric",

  // --- Presence/indicator fields that parse as "1" but are really categorical ---
  abh_front: "categorical",
  abh_rear: "categorical",
  at13w_front: "categorical",
  at13w_rear: "categorical",
  at15_front: "categorical",
  at15_rear: "categorical",
  bw22r_front: "categorical",
  bw22r_rear: "categorical",
  bw52r_front: "categorical",
  bw52r_rear: "categorical",
  c26_front: "categorical",
  c26_rear: "categorical",
  lower_arm_extension_front: "categorical",
  lower_arm_extension_rear: "categorical",
  pss_percent_setup_front: "categorical",
  pss_percent_setup_rear: "categorical",
  st05_r_front: "categorical",
  st05_r_rear: "categorical",
  st205_front: "categorical",
  st205_rear: "categorical",
};

export function getParameterClassificationOverride(
  key: string
): ParameterClassificationOverride | undefined {
  return PARAMETER_CLASSIFICATION_OVERRIDES[key];
}
