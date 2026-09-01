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

// NOTE: raw best/avg helpers were removed on purpose — they ignored per-lap
// exclusions. Use computeIncludedLapMetricsFromRun (lapAnalysis) instead.

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

/**
 * "13/5:12.345" — a five-minute stint the way LiveRC posts a result: laps first,
 * then the clock. `decimals: 1` is for tight cells (a run card figure at 390px),
 * `0` for the phone band's ~60px tile ("13/5:12"); the full three stay wherever
 * there is room.
 */
export function formatFiveMinuteStint(
  stint: { lapCount: number; seconds: number },
  decimals: 0 | 1 | 3 = 3
): string {
  if (!Number.isFinite(stint.seconds) || stint.seconds < 0) return "—";
  // Integer maths after rounding, so 311.96 at one decimal is "5:12.0", never "5:11.10"
  // and never a carry bug at "x:60.0".
  const scale = 10 ** decimals;
  let scaled = Math.round(stint.seconds * scale);
  const m = Math.floor(scaled / (60 * scale));
  scaled -= m * 60 * scale;
  const intS = Math.floor(scaled / scale);
  const frac = decimals > 0 ? `.${String(scaled % scale).padStart(decimals, "0")}` : "";
  return `${stint.lapCount}/${m}:${String(intS).padStart(2, "0")}${frac}`;
}
