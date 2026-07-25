/**
 * Cross-model touring parameters: one canonical id per concept so aggregations
 * can pool values across cars/sheets (e.g. average droop across all touring cars).
 *
 * Snapshot storage still uses each sheet's `key`; rebuild/compare map aliases
 * to `canonicalAggregationParameterKey()` before bucketing.
 */

/** Community aggregation bucket for all eligible touring docs (any template). */
export const UNIVERSAL_TOURING_TEMPLATE_ID = "universal_touring";

export type UniversalParameterDef = {
  /** Stable id used as `parameterKey` in aggregation rows. */
  id: string;
  label: string;
  /** Alternate snapshot keys that mean the same parameter. */
  aliases: string[];
};

/**
 * Front/rear pairs, link-geometry stacks, and shared tuning keys for generic + platform sheets.
 *
 * This registry is the app's single vocabulary for "the same knob on a different car". Adding a
 * concept here does three things: it pools the parameter across cars in community stats, it makes
 * the name a suggestion in the parameter-naming panel, and it therefore stops the next calibration
 * from minting a near-duplicate (`shock_oil_front` vs `damper_oil_front`). Anything a driver can
 * adjust on most touring cars belongs here.
 *
 * Canonical ids match the vehicle-dynamics KB's vocabulary (`damper_oil_*`, not `shock_oil_*`),
 * because that is what the Engineer reasons and cites with.
 */
export const UNIVERSAL_TOURING_PARAMETERS: UniversalParameterDef[] = [
  // --- Alignment ---
  { id: "toe_front", label: "Toe (Front)", aliases: [] },
  { id: "toe_rear", label: "Toe (Rear)", aliases: [] },
  { id: "camber_front", label: "Camber (Front)", aliases: [] },
  { id: "camber_rear", label: "Camber (Rear)", aliases: [] },
  { id: "caster_front", label: "Caster (Front)", aliases: [] },
  { id: "caster_rear", label: "Caster (Rear)", aliases: [] },

  // --- Ride height / travel ---
  { id: "ride_height_front", label: "Ride height (Front)", aliases: ["rh_front", "ride_ht_front"] },
  { id: "ride_height_rear", label: "Ride height (Rear)", aliases: ["rh_rear", "ride_ht_rear"] },
  /**
   * Droop and downstop are DIFFERENT measurements of the same travel limit and must never pool:
   * droop is ground → wheel (~21-24 mm), downstop is ground → bottom of arm (~4-7 mm). Averaging
   * a 5 into a 22 produces a median that describes no real car. `downstop_*` was an alias of
   * `droop_*` until 2026-07-25; it was split when the generic sheet gained both rows.
   * The Engineer's prompt already forbids equating them ("do not equate droop vs downstop").
   */
  { id: "droop_front", label: "Droop (Front)", aliases: [] },
  { id: "droop_rear", label: "Droop (Rear)", aliases: [] },
  { id: "downstop_front", label: "Downstop (Front)", aliases: [] },
  { id: "downstop_rear", label: "Downstop (Rear)", aliases: [] },

  // --- Damping / springs / bars ---
  { id: "spring_front", label: "Spring (Front)", aliases: ["spring_rate_front"] },
  { id: "spring_rear", label: "Spring (Rear)", aliases: ["spring_rate_rear"] },
  { id: "damper_oil_front", label: "Damper oil (Front)", aliases: ["shock_oil_front"] },
  { id: "damper_oil_rear", label: "Damper oil (Rear)", aliases: ["shock_oil_rear"] },
  { id: "arb_front", label: "Anti-roll bar (Front)", aliases: [] },
  { id: "arb_rear", label: "Anti-roll bar (Rear)", aliases: [] },

  /**
   * --- Link geometry ---
   *
   * The four-point rows are NOT per corner: left/right are symmetric, and the four values are the
   * front and rear pickup of the FRONT bulkhead (FF/FR) and of the REAR bulkhead (RF/RR). That
   * split is what gives anti-dive (FF−FR) and anti-squat (RF−RR).
   *
   * These are the keys the Engineer's roll-centre and link-balance reasoning runs on, so a sheet
   * without them gets a materially shallower answer.
   */
  { id: "upper_inner_shims_ff", label: "Upper inner shims (FF)", aliases: [] },
  { id: "upper_inner_shims_fr", label: "Upper inner shims (FR)", aliases: [] },
  { id: "upper_inner_shims_rf", label: "Upper inner shims (RF)", aliases: [] },
  { id: "upper_inner_shims_rr", label: "Upper inner shims (RR)", aliases: [] },
  { id: "under_lower_arm_shims_ff", label: "Under lower arm shims (FF)", aliases: [] },
  { id: "under_lower_arm_shims_fr", label: "Under lower arm shims (FR)", aliases: [] },
  { id: "under_lower_arm_shims_rf", label: "Under lower arm shims (RF)", aliases: [] },
  { id: "under_lower_arm_shims_rr", label: "Under lower arm shims (RR)", aliases: [] },
  { id: "upper_outer_shims_front", label: "Upper outer shims (Front)", aliases: [] },
  { id: "upper_outer_shims_rear", label: "Upper outer shims (Rear)", aliases: [] },
  { id: "under_hub_shims_front", label: "Under hub shims (Front)", aliases: [] },
  { id: "under_hub_shims_rear", label: "Under hub shims (Rear)", aliases: [] },
  { id: "bump_steer_shims_front", label: "Bump steer shims (Front)", aliases: [] },
  { id: "toe_gain_shims_rear", label: "Toe gain shims (Rear)", aliases: [] },

  // --- Drivetrain ---
  { id: "diff_oil", label: "Diff oil", aliases: [] },
];

const ALIAS_TO_CANONICAL = new Map<string, string>();
const CANONICAL_IDS = new Set<string>();

for (const def of UNIVERSAL_TOURING_PARAMETERS) {
  CANONICAL_IDS.add(def.id);
  ALIAS_TO_CANONICAL.set(def.id, def.id);
  for (const a of def.aliases) {
    ALIAS_TO_CANONICAL.set(a, def.id);
  }
}

/** Map a snapshot field key to the canonical aggregation parameter id. */
export function canonicalAggregationParameterKey(snapshotKey: string): string {
  const k = snapshotKey.trim();
  if (!k) return snapshotKey;
  return ALIAS_TO_CANONICAL.get(k) ?? k;
}

export function isUniversalTouringTuningParameter(parameterKey: string): boolean {
  return CANONICAL_IDS.has(canonicalAggregationParameterKey(parameterKey));
}

export function universalParameterIdForSnapshotKey(snapshotKey: string): string | undefined {
  const canonical = canonicalAggregationParameterKey(snapshotKey);
  return CANONICAL_IDS.has(canonical) ? canonical : undefined;
}

export function lookupUniversalParameterDef(id: string): UniversalParameterDef | undefined {
  const canonical = canonicalAggregationParameterKey(id);
  return UNIVERSAL_TOURING_PARAMETERS.find((p) => p.id === canonical);
}
