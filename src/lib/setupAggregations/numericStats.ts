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
};

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
  const n = values.length;
  if (n === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const sum = values.reduce((acc, x) => acc + x, 0);
  const mean = sum / n;
  const median =
    n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  let stdDev = 0;
  if (n > 1) {
    const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    stdDev = Math.sqrt(variance);
  }

  const p10 = linearPercentile(sorted, 0.1);
  const p25 = linearPercentile(sorted, 0.25);
  const p50 = linearPercentile(sorted, 0.5);
  const p75 = linearPercentile(sorted, 0.75);
  const p90 = linearPercentile(sorted, 0.9);
  const iqr = p75 - p25;
  const broadRange = p90 - p10;

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
  };
}
