/**
 * Minimum IQR-based compare threshold per parameter (same units as normalized Δ).
 * Effective threshold = max(iqr * IQR_THRESHOLD_MULTIPLIER, minForKey) so tiny sample IQRs
 * do not collapse the scale. Tune grouped defaults here only.
 */

const DEFAULT_MIN = 0.5;

/** Explicit floors for gradient keys; adjust in one place. */
const BY_PREFIX_AND_KEY: Array<{ test: (k: string) => boolean; min: number }> = [
  { test: (k) => k.startsWith("ride_height_"), min: 0.75 },
  { test: (k) => k.startsWith("droop_"), min: 0.5 },
  { test: (k) => k.startsWith("camber_") || k.startsWith("caster_"), min: 0.4 },
  { test: (k) => k.startsWith("toe_"), min: 0.25 },
  { test: (k) => k.includes("shims"), min: 0.5 },
  { test: (k) => k === "front_spring_rate_gf_mm" || k === "rear_spring_rate_gf_mm", min: 50 },
  { test: (k) => k.startsWith("arb_"), min: 0.35 },
  { test: (k) => k.startsWith("damper_oil_"), min: 1000 },
  { test: (k) => k.startsWith("damper_percent_"), min: 4 },
  { test: (k) => k === "diff_oil", min: 1500 },
];

export function getIqrGradientMinThreshold(parameterKey: string): number {
  for (const row of BY_PREFIX_AND_KEY) {
    if (row.test(parameterKey)) return row.min;
  }
  return DEFAULT_MIN;
}
