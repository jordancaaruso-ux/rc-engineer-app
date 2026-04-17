/**
 * Setup comparison gradient scale from car parameter aggregations (robust spread / IQR).
 * Score = |Δ| / threshold, capped; threshold = max(iqr * IQR_THRESHOLD_MULTIPLIER, per-key floor).
 */
import { getIqrGradientMinThreshold } from "@/lib/setupCompare/iqrGradientMinThreshold";

export type NumericAggregationCompareSlice = {
  sampleCount: number;
  iqr: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  broadRange: number;
};

/** Multiply IQR to get base comparison threshold (before per-key floor). */
export const IQR_THRESHOLD_MULTIPLIER = 2.0;

/** Max score before normalization to 0–1 gradient intensity. */
export const IQR_SCORE_CAP = 2.0;

export const MIN_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE = 5;

/**
 * Higher floor for community (all-eligible-setups) aggregations. Community rows pull from a
 * large pool, so we can afford to demand more samples per parameter before trusting the IQR.
 * Applied by `buildNumericAggregationMapFromCommunity` so low-sample keys don't end up in the
 * compare map and harmlessly fall through to the non-IQR fallback.
 */
export const MIN_COMMUNITY_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE = 20;

/**
 * Returns gradient intensity in [0, 1], or null to use plain low-confidence “different” (no heat scale).
 */
export function gradientIntensityFromIqrDelta(
  deltaAbs: number,
  agg: NumericAggregationCompareSlice | null | undefined,
  parameterKey: string
): number | null {
  if (agg == null) return null;
  if (agg.sampleCount < MIN_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE) return null;
  if (!Number.isFinite(agg.iqr) || agg.iqr <= 0) return null;
  if (!Number.isFinite(deltaAbs) || deltaAbs <= 0) return null;

  const baseThreshold = agg.iqr * IQR_THRESHOLD_MULTIPLIER;
  const minThreshold = getIqrGradientMinThreshold(parameterKey);
  const threshold = Math.max(baseThreshold, minThreshold);
  if (!(threshold > 0)) return null;

  const score = deltaAbs / threshold;
  const capped = Math.min(score, IQR_SCORE_CAP);
  return capped / IQR_SCORE_CAP;
}

export function parseNumericAggregationCompareSlice(json: unknown): NumericAggregationCompareSlice | null {
  if (json == null || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const sampleCount = Number(o.sampleCount);
  if (!Number.isFinite(sampleCount) || sampleCount < 0) return null;

  const read = (k: string): number => {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v === null || v === undefined) return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const p25 = read("p25");
  const p75 = read("p75");
  if (!Number.isFinite(p25) || !Number.isFinite(p75)) return null;

  const p50 = read("p50");
  const p10 = read("p10");
  const p90 = read("p90");
  const mid = Number.isFinite(p50) ? p50 : (p25 + p75) / 2;
  const lo = Number.isFinite(p10) ? p10 : p25;
  const hi = Number.isFinite(p90) ? p90 : p75;

  let iqr = read("iqr");
  if (!Number.isFinite(iqr)) iqr = p75 - p25;

  let broadRange = read("broadRange");
  if (!Number.isFinite(broadRange)) broadRange = hi - lo;

  return {
    sampleCount: Math.floor(sampleCount),
    iqr,
    p10: lo,
    p25,
    p50: mid,
    p75,
    p90: hi,
    broadRange,
  };
}
