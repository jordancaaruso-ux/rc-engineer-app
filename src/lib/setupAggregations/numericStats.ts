export type NumericStats = {
  sampleCount: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
};

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
  return { sampleCount: n, mean, median, stdDev, min, max };
}
