/**
 * Minimum meaningful absolute delta (in native parameter units) for cross-grip-bucket trend scoring.
 *
 * A grip trend only counts as `material` or `slight` when |median_high − median_low| is at least this
 * big, regardless of how tight or loose the community spread is. Complements the effect-size score
 * (Cliff's delta / IQR-ratio) by enforcing a domain-aware floor: e.g. diff oil in 1k grades makes a
 * 500 cSt drift meaningless even if the community happens to cluster tightly at one grade.
 *
 * Numbers here are tuned to be roughly one "human click" of the parameter — the smallest change a
 * driver would actually bother making.
 */

const DEFAULT_MIN_DELTA = 0.1;

const BY_PREFIX_AND_KEY: Array<{ test: (k: string) => boolean; min: number }> = [
  // Derived link-index composites (mm): one shim step ≈ 0.25 mm.
  { test: (k) => k.startsWith("derived_"), min: 0.25 },
  // Ride height and droop: 0.2 mm is about half the typical adjustment click.
  { test: (k) => k.startsWith("ride_height_"), min: 0.2 },
  { test: (k) => k.startsWith("droop_"), min: 0.2 },
  // Angles: 0.25° is the common calibration step.
  { test: (k) => k.startsWith("camber_"), min: 0.25 },
  { test: (k) => k.startsWith("caster_"), min: 0.25 },
  { test: (k) => k.startsWith("toe_"), min: 0.15 },
  // Shim stacks: 0.25 mm is the usual shim thickness; require one full shim to matter.
  { test: (k) => k.includes("shims"), min: 0.25 },
  // Springs: gf/mm. A full spring grade step is ~5 gf/mm.
  { test: (k) => k === "front_spring_rate_gf_mm" || k === "rear_spring_rate_gf_mm", min: 5 },
  { test: (k) => k.startsWith("spring_gap_"), min: 0.4 },
  // ARBs: 0.2 mm is one physical size step.
  { test: (k) => k.startsWith("arb_"), min: 0.2 },
  // Damper oil: one viscosity grade = 50 cSt. Require at least that.
  { test: (k) => k.startsWith("damper_oil_"), min: 50 },
  // Damper piston %: 2.5% ≈ smallest hole-pattern step.
  { test: (k) => k.startsWith("damper_percent_"), min: 2.5 },
  // Diff oil: grades in 1k-cSt steps; 1000 cSt is one full grade.
  { test: (k) => k === "diff_oil", min: 1000 },
  // Bump steer rod/block mm shim.
  { test: (k) => k.startsWith("bump_steer"), min: 0.25 },
  // HRB setting (Hydraulic Roll Bar) uses numbered detents; 1 click is the meaningful step.
  { test: (k) => k.includes("hrb"), min: 1 },
  // Steering angle setting: 1° is a typical click.
  { test: (k) => k.includes("steering_angle"), min: 1 },
  // Motor lateral shift: 0.5 mm is a real move.
  { test: (k) => k.includes("motor") && k.includes("shift"), min: 0.5 },
];

/**
 * Return the minimum absolute delta (in native units) that should be treated as a "real" trend
 * between two grip buckets for the given parameter. Anything below this is `flat` regardless of
 * effect-size score.
 */
export function getMinMeaningfulDelta(parameterKey: string): number {
  for (const row of BY_PREFIX_AND_KEY) {
    if (row.test(parameterKey)) return row.min;
  }
  return DEFAULT_MIN_DELTA;
}
