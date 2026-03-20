import type { LapMetrics } from "./types";

/** Fastest valid lap; null if none. */
export function computeLapMetrics(laps: number[]): LapMetrics {
  const clean = laps.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (clean.length === 0) {
    return { bestLap: null, averageTop5: null, lapCount: 0 };
  }
  const bestLap = Math.min(...clean);
  const fastest = [...clean].sort((a, b) => a - b).slice(0, 5);
  const averageTop5 = fastest.reduce((a, b) => a + b, 0) / fastest.length;
  return { bestLap, averageTop5, lapCount: clean.length };
}
