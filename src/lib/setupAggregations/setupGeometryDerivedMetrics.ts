/**
 * Geometry scalars derived from a setup snapshot for cross-setup comparison,
 * Engineer spread rows, and aggregation buckets.
 *
 * Since 2026-07-11 these are REAL computed geometry (roll center heights, roll-axis
 * rake, true arm angles) from the validated kinematics engine in `src/lib/rollCenter/`
 * — replacing the old shim-difference "link index" proxies that only guessed at arm
 * angle (see docs/ROLL_CENTER_NORTH_STAR.md, "Real arm angles retire the index proxies").
 *
 * Values exist only when a platform pack matches the snapshot (Awesomatix A800-family
 * today, resolved by key fingerprint). Absolute values inherit the pack's verification
 * grade; deltas between setups are datum-robust (tested).
 *
 * NOTE: aggregation rows are materialized — after this key change ships, rebuild via
 * POST /api/setup-aggregations/rebuild so the new keys appear in community/car stats.
 */
import type { SetupSnapshotValue } from "@/lib/runSetup";
import { computeRollCenterFromSnapshot } from "@/lib/rollCenter/computeFromSnapshot";

export const SETUP_GEOMETRY_DERIVED_KEYS_ORDERED = [
  "derived_roll_center_front_mm",
  "derived_roll_center_rear_mm",
  "derived_roll_axis_rake_mm",
  "derived_lower_arm_angle_front_deg",
  "derived_lower_arm_angle_rear_deg",
  "derived_upper_link_angle_front_deg",
  "derived_upper_link_angle_rear_deg",
] as const;

export type SetupGeometryDerivedKey = (typeof SETUP_GEOMETRY_DERIVED_KEYS_ORDERED)[number];

const DERIVED_SET = new Set<string>(SETUP_GEOMETRY_DERIVED_KEYS_ORDERED);

export function isSetupGeometryDerivedKey(key: string): key is SetupGeometryDerivedKey {
  return DERIVED_SET.has(key);
}

/** Human labels for Engineer / prompts (keys stay machine ids). */
export const SETUP_GEOMETRY_DERIVED_LABELS: Record<SetupGeometryDerivedKey, string> = {
  derived_roll_center_front_mm:
    "Front roll center height (geometric, computed from measured platform geometry; + = above ground)",
  derived_roll_center_rear_mm:
    "Rear roll center height (geometric, computed from measured platform geometry; + = above ground)",
  derived_roll_axis_rake_mm:
    "Roll axis rake (rear RC − front RC; + = axis rakes down toward the front)",
  derived_lower_arm_angle_front_deg:
    "Front lower arm angle (true computed angle; + = outer end higher than inner)",
  derived_lower_arm_angle_rear_deg:
    "Rear lower arm angle (true computed angle; + = outer end higher than inner)",
  derived_upper_link_angle_front_deg:
    "Front upper link angle (true computed angle; + = outer end higher than inner)",
  derived_upper_link_angle_rear_deg:
    "Rear upper link angle (true computed angle; + = outer end higher than inner)",
};

/** Display unit for a derived key (mm vs °). */
export function setupGeometryDerivedUnit(key: SetupGeometryDerivedKey): "mm" | "°" {
  return key.endsWith("_deg") ? "°" : "mm";
}

export type SetupGeometryDerivedMetrics = Record<SetupGeometryDerivedKey, number | null>;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Computes derived geometry from a normalized setup snapshot (plain object).
 * All-null when no platform pack matches the snapshot.
 */
export function computeSetupGeometryDerivedMetrics(
  data: Record<string, SetupSnapshotValue>
): SetupGeometryDerivedMetrics {
  const empty: SetupGeometryDerivedMetrics = {
    derived_roll_center_front_mm: null,
    derived_roll_center_rear_mm: null,
    derived_roll_axis_rake_mm: null,
    derived_lower_arm_angle_front_deg: null,
    derived_lower_arm_angle_rear_deg: null,
    derived_upper_link_angle_front_deg: null,
    derived_upper_link_angle_rear_deg: null,
  };
  const computed = computeRollCenterFromSnapshot(data);
  if (!computed) return empty;
  return {
    derived_roll_center_front_mm: round2(computed.front.rcHeightMm),
    derived_roll_center_rear_mm: round2(computed.rear.rcHeightMm),
    derived_roll_axis_rake_mm: round2(computed.rakeMm),
    derived_lower_arm_angle_front_deg: round2(computed.front.lowerArmAngleDeg),
    derived_lower_arm_angle_rear_deg: round2(computed.rear.lowerArmAngleDeg),
    derived_upper_link_angle_front_deg: round2(computed.front.upperLinkAngleDeg),
    derived_upper_link_angle_rear_deg: round2(computed.rear.upperLinkAngleDeg),
  };
}

/**
 * Scalar observations to merge into aggregation pipelines (one doc → one value per key when computable).
 */
export function geometryDerivedScalarObservations(
  data: Record<string, SetupSnapshotValue>
): Array<[string, { tag: "scalar"; nOrS: number }]> {
  const m = computeSetupGeometryDerivedMetrics(data);
  const out: Array<[string, { tag: "scalar"; nOrS: number }]> = [];
  for (const k of SETUP_GEOMETRY_DERIVED_KEYS_ORDERED) {
    const n = m[k];
    if (n == null || !Number.isFinite(n)) continue;
    out.push([k, { tag: "scalar", nOrS: n }]);
  }
  return out;
}
