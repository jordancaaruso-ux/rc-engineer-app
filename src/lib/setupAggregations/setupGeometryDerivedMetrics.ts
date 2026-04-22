/**
 * Shim-derived mm scalars for cross-setup comparison (not literal link ° in the data).
 * Upper index (per axle, two inners + one outer per end): upper outer shims − average(upper inner L/R on that axle).
 * Greater value ⇒ more angled upper link; smaller ⇒ flatter.
 * Lower index (per axle, two under-lowers + one hub per end): average(under-lower inner L/R) + under hub on that end.
 * Use lower indices for relativity between setups, not as absolute “height.”
 * Balance rows: front index − rear index (upper and lower) for front-vs-rear comparison.
 */
import type { SetupSnapshotValue } from "@/lib/runSetup";

export const SETUP_GEOMETRY_DERIVED_KEYS_ORDERED = [
  "derived_upper_link_index_front_mm",
  "derived_upper_link_index_rear_mm",
  "derived_upper_link_stagger_mm",
  "derived_lower_link_index_front_mm",
  "derived_lower_link_index_rear_mm",
  "derived_lower_link_stagger_mm",
] as const;

export type SetupGeometryDerivedKey = (typeof SETUP_GEOMETRY_DERIVED_KEYS_ORDERED)[number];

const DERIVED_SET = new Set<string>(SETUP_GEOMETRY_DERIVED_KEYS_ORDERED);

export function isSetupGeometryDerivedKey(key: string): key is SetupGeometryDerivedKey {
  return DERIVED_SET.has(key);
}

/** Human labels for Engineer / prompts (keys stay machine ids). */
export const SETUP_GEOMETRY_DERIVED_LABELS: Record<SetupGeometryDerivedKey, string> = {
  derived_upper_link_index_front_mm: "Upper link index front (upper outer − avg upper inner; larger = more angled)",
  derived_upper_link_index_rear_mm: "Upper link index rear (upper outer − avg upper inner; larger = more angled)",
  derived_upper_link_stagger_mm: "Upper link balance (front index − rear index; + = front more angled vs rear)",
  derived_lower_link_index_front_mm: "Lower link index front (avg under-lower inner + under hub F)",
  derived_lower_link_index_rear_mm: "Lower link index rear (avg under-lower inner + under hub R)",
  derived_lower_link_stagger_mm: "Lower arm balance (front index − rear index; front vs rear lower-line proxy)",
};

function parseShimMm(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v ?? "").trim();
  if (!s || s === "—" || s === "-") return null;
  const cleaned = s.replace(/mm/gi, "").replace(",", ".").trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function avg2(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return (a + b) / 2;
}

export type SetupGeometryDerivedMetrics = {
  derived_upper_link_index_front_mm: number | null;
  derived_upper_link_index_rear_mm: number | null;
  derived_upper_link_stagger_mm: number | null;
  derived_lower_link_index_front_mm: number | null;
  derived_lower_link_index_rear_mm: number | null;
  derived_lower_link_stagger_mm: number | null;
};

/**
 * Computes derived link indices from a normalized setup snapshot (plain object).
 */
export function computeSetupGeometryDerivedMetrics(data: Record<string, SetupSnapshotValue>): SetupGeometryDerivedMetrics {
  const uiff = parseShimMm(data.upper_inner_shims_ff);
  const uifr = parseShimMm(data.upper_inner_shims_fr);
  const uirf = parseShimMm(data.upper_inner_shims_rf);
  const uirr = parseShimMm(data.upper_inner_shims_rr);
  const uof = parseShimMm(data.upper_outer_shims_front);
  const uor = parseShimMm(data.upper_outer_shims_rear);

  const ulff = parseShimMm(data.under_lower_arm_shims_ff);
  const ulfr = parseShimMm(data.under_lower_arm_shims_fr);
  const ulrf = parseShimMm(data.under_lower_arm_shims_rf);
  const ulrr = parseShimMm(data.under_lower_arm_shims_rr);
  const hubf = parseShimMm(data.under_hub_shims_front);
  const hubr = parseShimMm(data.under_hub_shims_rear);

  const upperFront = avg2(uiff, uifr);
  const upperRear = avg2(uirf, uirr);
  const lowerFront = avg2(ulff, ulfr);
  const lowerRear = avg2(ulrf, ulrr);

  const derived_upper_link_index_front_mm =
    upperFront != null && uof != null ? uof - upperFront : null;
  const derived_upper_link_index_rear_mm =
    upperRear != null && uor != null ? uor - upperRear : null;
  const derived_upper_link_stagger_mm =
    derived_upper_link_index_front_mm != null && derived_upper_link_index_rear_mm != null
      ? derived_upper_link_index_front_mm - derived_upper_link_index_rear_mm
      : null;

  const derived_lower_link_index_front_mm =
    lowerFront != null && hubf != null ? lowerFront + hubf : null;
  const derived_lower_link_index_rear_mm =
    lowerRear != null && hubr != null ? lowerRear + hubr : null;
  const derived_lower_link_stagger_mm =
    derived_lower_link_index_front_mm != null && derived_lower_link_index_rear_mm != null
      ? derived_lower_link_index_front_mm - derived_lower_link_index_rear_mm
      : null;

  return {
    derived_upper_link_index_front_mm,
    derived_upper_link_index_rear_mm,
    derived_upper_link_stagger_mm,
    derived_lower_link_index_front_mm,
    derived_lower_link_index_rear_mm,
    derived_lower_link_stagger_mm,
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
