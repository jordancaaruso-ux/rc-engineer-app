/** Lap time helpers for runs. */

import type { LapMetrics } from "@/lib/lapSession/types";
import { computeLapMetrics as computeLapMetricsCore } from "@/lib/lapSession/metrics";

export function normalizeLapTimes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((n) => typeof n === "number" && Number.isFinite(n));
}

export function computeLapMetrics(laps: number[]): LapMetrics {
  return computeLapMetricsCore(laps);
}

export function bestLap(value: unknown): number | null {
  return computeLapMetricsCore(normalizeLapTimes(value)).bestLap;
}

export function avgTop5(value: unknown): number | null {
  return computeLapMetricsCore(normalizeLapTimes(value)).averageTop5;
}

export function formatLap(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(3);
}

/** Stint length as `m:ss.xxx` (included-lap sum). */
export function formatStintTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const sStr = s.toFixed(3);
  const [intS, dec = "000"] = sStr.split(".");
  const intPadded = intS!.padStart(2, "0");
  return `${m}:${intPadded}.${dec}`;
}
