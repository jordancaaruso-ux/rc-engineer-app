import type { NumericStats } from "@/lib/setupAggregations/numericStats";

/**
 * How many adjustment steps either side of the base value still counts as being in the window.
 * Inside ±1 step is `mid`; past ±this is `below_typical` / `above_typical`.
 *
 * This single number decides how trigger-happy the out-of-window hedge is
 * (`computeHedgedAtPosition` in `parameterEffects/query.ts`). Raise it to hedge less often.
 *
 * Only used when one published sheet carries the parameter. Two or more have a real range of their
 * own and don't need a synthetic width.
 */
export const BASE_SETUP_SHOULDER_STEPS = 3;

/**
 * Build a spread-shaped window around a single base-setup value.
 *
 * One published sheet is one point, not a population — it gives a centre but no width, so the width
 * comes from the founder-authored per-parameter step (`getParameterStep`). The result is
 * deliberately shaped like `NumericStats` so the existing `bandForValue()` consumes it unchanged;
 * that reuse is the point of the design, since it lights up every downstream reader of
 * `positionBand` (the hedge, the dashboard prompt rules, the reasoning spine) without touching any
 * of them.
 *
 * `sampleCount` is 1 and must stay 1 here — it is what keeps a single sheet from being read as a
 * distribution. `baseSetupStatsFromValues` is the only thing allowed to report a higher count, and
 * only because a higher count there means real published sheets, not measured runs.
 */
export function synthesizeBaseSetupStats(centre: number, step: number): NumericStats | null {
  if (!Number.isFinite(centre) || !Number.isFinite(step) || step <= 0) return null;
  const shoulder = step * BASE_SETUP_SHOULDER_STEPS;
  return {
    sampleCount: 1,
    mean: centre,
    median: centre,
    stdDev: 0,
    min: centre - shoulder,
    max: centre + shoulder,
    p10: centre - shoulder,
    p25: centre - step,
    p50: centre,
    p75: centre + step,
    p90: centre + shoulder,
    iqr: step * 2,
    broadRange: shoulder * 2,
    valueHistogram: {},
    distinctValueCount: 0,
  };
}

/** Linear-interpolated percentile over an ascending array. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Bands for one parameter from every baseline setup published against the chassis.
 *
 * A chassis doesn't need a kit sheet for this to work. A manufacturer that publishes a spread of
 * setups across conditions — low/medium/high grip, asphalt and carpet — has already stated the
 * range it considers sane for the car, and that range is a better reference than a synthetic window
 * around any single sheet. So with two or more values the band edges ARE the published range:
 * `p10`/`p90` are the real min/max, and a value outside them is outside everything the chassis'
 * own setups do.
 *
 * `step` is only consulted in the degenerate cases — one sheet, or several that all chose the same
 * value. Those have no width of their own, so they fall back to the authored step window; without
 * that fallback a zero-width range would read every neighbouring value as extreme.
 *
 * `sampleCount` is the number of published sheets carrying this parameter — never a count of runs.
 * Callers must keep saying so: these are authored reference sheets, not measured data. It stays
 * under `softPriorsFromAggregation`'s `MIN_SAMPLES = 5` for any chassis with fewer than five
 * published baselines.
 */
export function baseSetupStatsFromValues(
  values: readonly number[],
  step: number | null
): NumericStats | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  if (sorted.length === 1 || min === max) {
    return step == null ? null : synthesizeBaseSetupStats(min, step);
  }

  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const median = percentile(sorted, 0.5);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);

  return {
    sampleCount: n,
    mean,
    median,
    stdDev: Math.sqrt(variance),
    min,
    max,
    // The published range is the edge. With a handful of authored sheets there is no tail to
    // estimate, so widening past min/max would invent room the manufacturer never used.
    p10: min,
    p25,
    p50: median,
    p75,
    p90: max,
    iqr: p75 - p25,
    broadRange: max - min,
    valueHistogram: {},
    distinctValueCount: new Set(sorted).size,
  };
}
