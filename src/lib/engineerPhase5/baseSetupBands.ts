import type { NumericStats } from "@/lib/setupAggregations/numericStats";

/**
 * How many adjustment steps either side of the base value still counts as being in the window.
 * Inside ±1 step is `mid`; past ±this is `below_typical` / `above_typical`.
 *
 * This single number decides how trigger-happy the out-of-window hedge is
 * (`computeHedgedAtPosition` in `parameterEffects/query.ts`). Raise it to hedge less often.
 */
export const BASE_SETUP_SHOULDER_STEPS = 3;

/**
 * Build a spread-shaped window around a single base-setup value.
 *
 * A base setup is one point, not a population — it gives a centre but no width, so the width comes
 * from the founder-authored per-parameter step (`getParameterStep`). The result is deliberately
 * shaped like `NumericStats` so the existing `bandForValue()` consumes it unchanged; that reuse is
 * the point of the design, since it lights up every downstream reader of `positionBand` (the hedge,
 * the dashboard prompt rules, the reasoning spine) without touching any of them.
 *
 * `sampleCount` is 1 and must stay 1. It is what keeps this from being read as a real distribution —
 * e.g. `softPriorsFromAggregation` gates at `MIN_SAMPLES = 5`, so it can never pick these up.
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
