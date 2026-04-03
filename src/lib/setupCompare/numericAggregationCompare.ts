/**
 * Setup comparison gradient scale from car parameter aggregations (robust spread / IQR).
 * Score = |Δ| / (iqr * IQR_THRESHOLD_MULTIPLIER), capped; not std-dev or rarity based.
 */

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

/** Multiply IQR to get comparison threshold (tune here only). */
export const IQR_THRESHOLD_MULTIPLIER = 1.25;

/** Max score before normalization to 0–1 gradient intensity. */
export const IQR_SCORE_CAP = 1.75;

export const MIN_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE = 5;

/**
 * Returns gradient intensity in [0, 1], or null to use plain low-confidence “different” (no heat scale).
 */
export function gradientIntensityFromIqrDelta(
  deltaAbs: number,
  agg: NumericAggregationCompareSlice | null | undefined
): number | null {
  if (agg == null) return null;
  if (agg.sampleCount < MIN_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE) return null;
  if (!Number.isFinite(agg.iqr) || agg.iqr <= 0) return null;
  if (!Number.isFinite(deltaAbs) || deltaAbs <= 0) return null;

  const threshold = agg.iqr * IQR_THRESHOLD_MULTIPLIER;
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
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const p10 = read("p10");
  const p25 = read("p25");
  const p50 = read("p50");
  const p75 = read("p75");
  const p90 = read("p90");
  let iqr = read("iqr");
  if (![p10, p25, p50, p75, p90].every((x) => Number.isFinite(x))) return null;
  if (!Number.isFinite(iqr)) {
    iqr = p75 - p25;
  }
  const broadRange = Number.isFinite(read("broadRange")) ? read("broadRange") : p90 - p10;

  return {
    sampleCount: Math.floor(sampleCount),
    iqr,
    p10,
    p25,
    p50,
    p75,
    p90,
    broadRange,
  };
}
