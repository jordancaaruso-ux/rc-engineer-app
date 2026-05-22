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

/** Front/rear pairs and shared tuning keys for generic + most platform sheets. */
export const UNIVERSAL_TOURING_PARAMETERS: UniversalParameterDef[] = [
  { id: "toe_front", label: "Toe (Front)", aliases: [] },
  { id: "toe_rear", label: "Toe (Rear)", aliases: [] },
  { id: "ride_height_front", label: "Ride height (Front)", aliases: ["rh_front", "ride_ht_front"] },
  { id: "ride_height_rear", label: "Ride height (Rear)", aliases: ["rh_rear", "ride_ht_rear"] },
  { id: "droop_front", label: "Droop (Front)", aliases: ["downstop_front"] },
  { id: "droop_rear", label: "Droop (Rear)", aliases: ["downstop_rear"] },
  { id: "camber_front", label: "Camber (Front)", aliases: [] },
  { id: "camber_rear", label: "Camber (Rear)", aliases: [] },
  { id: "spring_front", label: "Spring (Front)", aliases: [] },
  { id: "spring_rear", label: "Spring (Rear)", aliases: [] },
  { id: "shock_oil_front", label: "Shock oil (Front)", aliases: ["damper_oil_front"] },
  { id: "shock_oil_rear", label: "Shock oil (Rear)", aliases: ["damper_oil_rear"] },
  { id: "arb_front", label: "Anti-roll bar (Front)", aliases: [] },
  { id: "arb_rear", label: "Anti-roll bar (Rear)", aliases: [] },
  { id: "roll_center_front", label: "Roll center (Front)", aliases: [] },
  { id: "roll_center_rear", label: "Roll center (Rear)", aliases: [] },
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
