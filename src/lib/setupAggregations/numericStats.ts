/** Cap on distinct values we store in the per-bucket histogram. Anything beyond is lumped into "__other". */
export const NUMERIC_HISTOGRAM_MAX_BUCKETS = 20;

export type NumericStats = {
  sampleCount: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  /** Inclusive linear interpolation on sorted values, p ∈ [0, 1]. */
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  iqr: number;
  broadRange: number;
  /**
   * Discrete-value frequency map for the bucket (keyed by canonical string of the numeric value).
   * Capped at top {@link NUMERIC_HISTOGRAM_MAX_BUCKETS} values by count; remaining values are lumped
   * into `"__other"`. This enables modal-value reporting and non-parametric effect-size comparisons
   * (Cliff's delta) between buckets without storing every raw observation.
   */
  valueHistogram: Record<string, number>;
  /** Count of distinct numeric values observed in the bucket (before the top-K cap). */
  distinctValueCount: number;
};

/**
 * Stable canonical string key for a numeric value — guards against float-noise keys like
 * `"0.30000000000000004"` by rounding to 6 decimals before stringifying.
 */
export function numericHistogramKey(v: number): string {
  if (!Number.isFinite(v)) return "";
  const rounded = Math.round(v * 1e6) / 1e6;
  return String(rounded);
}

/**
 * Deterministic linear interpolation percentile on sorted ascending data (same as p=0..1 on index span).
 */
export function linearPercentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0]!;
  const clamped = Math.min(1, Math.max(0, p));
  const pos = clamped * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  const w = pos - lo;
  return sortedAsc[lo]! * (1 - w) + sortedAsc[hi]! * w;
}

export function computeNumericStats(values: number[]): NumericStats | null {
  const finite = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  const n = finite.length;
  if (n === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const sum = finite.reduce((acc, x) => acc + x, 0);
  const mean = sum / n;
  const median =
    n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  let stdDev = 0;
  if (n > 1) {
    const variance = finite.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    stdDev = Math.sqrt(variance);
  }

  const p10 = linearPercentile(sorted, 0.1);
  const p25 = linearPercentile(sorted, 0.25);
  const p50 = linearPercentile(sorted, 0.5);
  const p75 = linearPercentile(sorted, 0.75);
  const p90 = linearPercentile(sorted, 0.9);
  const iqr = p75 - p25;
  const broadRange = p90 - p10;

  // Discrete-value frequency, capped at NUMERIC_HISTOGRAM_MAX_BUCKETS; remainder → "__other".
  const freq = new Map<string, number>();
  for (const v of finite) {
    const k = numericHistogramKey(v);
    if (!k) continue;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const distinctValueCount = freq.size;
  const sortedEntries = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const valueHistogram: Record<string, number> = {};
  if (sortedEntries.length <= NUMERIC_HISTOGRAM_MAX_BUCKETS) {
    for (const [k, c] of sortedEntries) valueHistogram[k] = c;
  } else {
    let otherTotal = 0;
    for (let i = 0; i < sortedEntries.length; i++) {
      const [k, c] = sortedEntries[i]!;
      if (i < NUMERIC_HISTOGRAM_MAX_BUCKETS) {
        valueHistogram[k] = c;
      } else {
        otherTotal += c;
      }
    }
    if (otherTotal > 0) valueHistogram["__other"] = otherTotal;
  }

  return {
    sampleCount: n,
    mean,
    median,
    stdDev,
    min,
    max,
    p10,
    p25,
    p50,
    p75,
    p90,
    iqr,
    broadRange,
    valueHistogram,
    distinctValueCount,
  };
}
