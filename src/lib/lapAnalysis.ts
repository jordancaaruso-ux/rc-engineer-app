import type { LapMetrics } from "@/lib/lapSession/types";
import { computeLapMetrics } from "@/lib/lapSession/metrics";
import { normalizeLapTimes } from "@/lib/runLaps";

export type LapRow = {
  lapNumber: number;
  lapTimeSeconds: number;
  isIncluded: boolean;
};

export type ComparisonSeries = {
  id: string;
  label: string;
  sourceType: "run" | "imported";
  laps: LapRow[];
  bestLap: number | null;
  avgTop5: number | null;
  avgTop10: number | null;
};

export type LapSeriesAnalysis = {
  lapCount: number;
  bestLap: number | null;
  averageLap: number | null;
  averageTop5: number | null;
  consistencyStdDev: number | null;
  spread: number | null;
};

export type LapSeriesComparison = {
  deltaBestLap: number | null;
  deltaAverageLap: number | null;
  deltaAverageTop5: number | null;
};

/** Included laps only: not lap 0, not excluded, finite time. */
export function getIncludedLaps(laps: LapRow[]): LapRow[] {
  return laps.filter(
    (l) =>
      l.lapNumber !== 0 &&
      l.isIncluded &&
      typeof l.lapTimeSeconds === "number" &&
      Number.isFinite(l.lapTimeSeconds)
  );
}

export function getBestLap(laps: LapRow[]): number | null {
  const inc = getIncludedLaps(laps);
  if (inc.length === 0) return null;
  return Math.min(...inc.map((l) => l.lapTimeSeconds));
}

/** Mean of fastest N laps (or fewer if not enough included laps). */
export function getAverageTopN(laps: LapRow[], n: number): number | null {
  const times = getIncludedLaps(laps).map((l) => l.lapTimeSeconds);
  if (times.length === 0 || n < 1) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const slice = sorted.slice(0, Math.min(n, sorted.length));
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function buildComparisonSeries(
  id: string,
  label: string,
  sourceType: "run" | "imported",
  laps: LapRow[]
): ComparisonSeries {
  return {
    id,
    label,
    sourceType,
    laps,
    bestLap: getBestLap(laps),
    avgTop5: getAverageTopN(laps, 5),
    avgTop10: getAverageTopN(laps, 10),
  };
}

/** Union of lap numbers (excluding 0), sorted ascending. */
export function alignLapsByNumber(seriesList: ComparisonSeries[]): number[] {
  const set = new Set<number>();
  for (const s of seriesList) {
    for (const l of s.laps) {
      if (l.lapNumber !== 0) set.add(l.lapNumber);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** Max |delta| (seconds) for full-strength tint in `getDeltaStyle`. */
export const DELTA_MAX_ABS_RANGE = 1.0;

/**
 * Smooth opacity gradient vs target (comparison columns only).
 * delta = comparison − target (positive = slower → red, negative → blue tint).
 * alpha = 0.05 + normalized * 0.8 where normalized = min(|delta| / maxAbs, 1).
 */
export function getDeltaStyle(
  delta: number,
  maxAbsDelta: number = DELTA_MAX_ABS_RANGE
): { backgroundColor: string } {
  if (!Number.isFinite(delta)) {
    return { backgroundColor: "transparent" };
  }
  const absDelta = Math.abs(delta);
  const normalized = Math.min(absDelta / maxAbsDelta, 1);
  const alpha = 0.05 + normalized * 0.8;
  if (absDelta < 1e-9) {
    return { backgroundColor: "rgba(128, 128, 128, 0.06)" };
  }
  if (delta > 0) {
    return { backgroundColor: `rgba(255, 0, 0, ${alpha})` };
  }
  return { backgroundColor: `rgba(37, 99, 235, ${alpha})` };
}

export type SummaryMetricDeltas = {
  bestDelta: number | null;
  avgTop5Delta: number | null;
  avgTop10Delta: number | null;
};

/** Summary deltas for comparison column headers (comparison − target). */
export function computeSummaryDeltas(
  target: ComparisonSeries,
  comparison: ComparisonSeries
): SummaryMetricDeltas {
  return {
    bestDelta:
      target.bestLap != null && comparison.bestLap != null
        ? comparison.bestLap - target.bestLap
        : null,
    avgTop5Delta:
      target.avgTop5 != null && comparison.avgTop5 != null
        ? comparison.avgTop5 - target.avgTop5
        : null,
    avgTop10Delta:
      target.avgTop10 != null && comparison.avgTop10 != null
        ? comparison.avgTop10 - target.avgTop10
        : null,
  };
}

/** Slower vs target: positive with `+`; faster: negative. Zero uses `+0.000`. */
export function formatLapDelta(delta: number): string {
  if (!Number.isFinite(delta)) return "";
  if (Math.abs(delta) < 1e-9) return "+0.000";
  if (delta > 0) return `+${delta.toFixed(3)}`;
  return delta.toFixed(3);
}

export const LAP_SERIES_EQUIVALENCE_TOLERANCE = 0.0005;

/**
 * True when included laps match: same count, same lap numbers in order, times within tolerance.
 * Excluded laps are ignored; only `getIncludedLaps` sequences are compared.
 */
export function areLapSeriesEquivalent(
  a: LapRow[],
  b: LapRow[],
  tolerance = LAP_SERIES_EQUIVALENCE_TOLERANCE
): boolean {
  const ia = getIncludedLaps(a);
  const ib = getIncludedLaps(b);
  if (ia.length !== ib.length) return false;
  for (let i = 0; i < ia.length; i++) {
    if (ia[i].lapNumber !== ib[i].lapNumber) return false;
    if (Math.abs(ia[i].lapTimeSeconds - ib[i].lapTimeSeconds) >= tolerance) return false;
  }
  return true;
}

/** Remove imports that duplicate primary, then remove imports that duplicate each other (first wins). */
export function filterDuplicateImportedSeries(
  primary: ComparisonSeries,
  imported: ComparisonSeries[]
): ComparisonSeries[] {
  const kept: ComparisonSeries[] = [];
  for (const s of imported) {
    if (areLapSeriesEquivalent(s.laps, primary.laps)) continue;
    if (kept.some((k) => areLapSeriesEquivalent(s.laps, k.laps))) continue;
    kept.push(s);
  }
  return kept;
}

export function lapRowsFromTimesAndFlags(
  lapTimes: number[],
  perLap?: Array<{ isIncluded?: boolean } | null> | null
): LapRow[] {
  return lapTimes.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSeconds: t,
    isIncluded: perLap?.[i]?.isIncluded !== false,
  }));
}

function tryReadPrimaryPerLap(raw: unknown): Array<{ isIncluded?: boolean } | null> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  const entries = o.entries;
  if (!Array.isArray(entries) || !entries[0] || typeof entries[0] !== "object") return null;
  const e0 = entries[0] as Record<string, unknown>;
  const perLap = e0.perLap;
  if (!Array.isArray(perLap)) return null;
  return perLap as Array<{ isIncluded?: boolean } | null>;
}

/** Primary laps from a run: lapTimes + optional lapSession per-lap inclusion. */
export function primaryLapRowsFromRun(run: { lapTimes: unknown; lapSession?: unknown }): LapRow[] {
  const times = normalizeLapTimes(run.lapTimes);
  const perLap = tryReadPrimaryPerLap(run.lapSession);
  if (perLap && perLap.length === times.length) {
    return lapRowsFromTimesAndFlags(times, perLap);
  }
  return lapRowsFromTimesAndFlags(times, null);
}

/**
 * Best / Avg 5 / lapCount from included laps only (lap #0 and `isIncluded: false` omitted).
 * Shared entry point for dashboard and other summaries that must match run review exclusions.
 */
export function computeIncludedLapMetricsFromRun(run: {
  lapTimes: unknown;
  lapSession?: unknown;
}): LapMetrics {
  const rows = primaryLapRowsFromRun(run);
  const times = getIncludedLaps(rows).map((l) => l.lapTimeSeconds);
  return computeLapMetrics(times);
}

/**
 * Summary metrics persisted on `Run` (`bestLapSeconds`, `avgTop5LapSeconds`)
 * so list pages don't have to recompute from the full lap JSON for every row.
 * Writers call this at save time; list readers prefer the stored columns and
 * only fall back to this for legacy rows where the columns are null.
 */
export function computePersistedRunLapSummary(run: {
  lapTimes: unknown;
  lapSession?: unknown;
}): { bestLapSeconds: number | null; avgTop5LapSeconds: number | null } {
  const rows = primaryLapRowsFromRun(run);
  return {
    bestLapSeconds: getBestLap(rows),
    avgTop5LapSeconds: getAverageTopN(rows, 5),
  };
}

export function importedSetToLapRows(
  laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded?: boolean }>
): LapRow[] {
  return laps.map((l) => ({
    lapNumber: l.lapNumber,
    lapTimeSeconds: l.lapTimeSeconds,
    isIncluded: l.isIncluded !== false,
  }));
}

export function analyzeLapSeries(rawLaps: unknown): LapSeriesAnalysis {
  const laps = normalizeLapTimes(rawLaps);
  if (laps.length === 0) {
    return {
      lapCount: 0,
      bestLap: null,
      averageLap: null,
      averageTop5: null,
      consistencyStdDev: null,
      spread: null,
    };
  }

  const sorted = [...laps].sort((a, b) => a - b);
  const bestLap = sorted[0] ?? null;
  const averageLap = laps.reduce((a, b) => a + b, 0) / laps.length;
  const top5 = sorted.slice(0, Math.min(5, sorted.length));
  const averageTop5 = top5.reduce((a, b) => a + b, 0) / top5.length;
  const variance = laps.reduce((acc, t) => acc + (t - averageLap) ** 2, 0) / laps.length;
  const consistencyStdDev = Math.sqrt(variance);
  const spread = (sorted[sorted.length - 1] ?? averageLap) - (sorted[0] ?? averageLap);

  return {
    lapCount: laps.length,
    bestLap,
    averageLap,
    averageTop5,
    consistencyStdDev,
    spread,
  };
}

/** Metrics using only included laps (and ignoring lap #0). */
export function analyzeLapRows(laps: LapRow[]): LapSeriesAnalysis {
  const times = getIncludedLaps(laps).map((l) => l.lapTimeSeconds);
  return analyzeLapSeries(times);
}

export type IncludedLapDashboardMetrics = {
  lapCount: number;
  /** Sum of included lap times (seconds). */
  stintSeconds: number | null;
  bestLap: number | null;
  avgTop5: number | null;
  avgTop10: number | null;
  median: number | null;
  /** RC-style score: 100 − CV, clamped [0, 100]; higher = more consistent. */
  consistencyScore: number | null;
};

/** Count of included laps (lap #0 and excluded omitted). */
export function getLapCount(laps: LapRow[]): number {
  return getIncludedLaps(laps).length;
}

/**
 * Map coefficient of variation (%) to a “higher is better” consistency score.
 * cv > 100 → 0; cv < 0 → 100; else 100 − cv clamped to [0, 100].
 */
export function computeConsistencyFromCV(cv: number): number {
  if (!Number.isFinite(cv)) return 0;
  const score = 100 - cv;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

/** Single pass over included laps for compact run-summary UI. */
export function getIncludedLapDashboardMetrics(laps: LapRow[]): IncludedLapDashboardMetrics {
  const times = getIncludedLaps(laps).map((l) => l.lapTimeSeconds);
  if (times.length === 0) {
    return {
      lapCount: 0,
      stintSeconds: null,
      bestLap: null,
      avgTop5: null,
      avgTop10: null,
      median: null,
      consistencyScore: null,
    };
  }
  const sorted = [...times].sort((a, b) => a - b);
  const stintSeconds = times.reduce((a, b) => a + b, 0);
  const bestLap = sorted[0] ?? null;
  const avgTop5 = getAverageTopN(laps, 5);
  const avgTop10 = getAverageTopN(laps, 10);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 1 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const analysis = analyzeLapSeries(times);
  const cvPercent =
    analysis.averageLap != null &&
    analysis.averageLap > 0 &&
    analysis.consistencyStdDev != null
      ? (analysis.consistencyStdDev / analysis.averageLap) * 100
      : null;
  const consistencyScore = cvPercent != null ? computeConsistencyFromCV(cvPercent) : null;
  return {
    lapCount: times.length,
    stintSeconds,
    bestLap,
    avgTop5,
    avgTop10,
    median,
    consistencyScore,
  };
}

export function compareLapSeries(base: LapSeriesAnalysis, other: LapSeriesAnalysis): LapSeriesComparison {
  const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : b - a);
  return {
    deltaBestLap: delta(base.bestLap, other.bestLap),
    deltaAverageLap: delta(base.averageLap, other.averageLap),
    deltaAverageTop5: delta(base.averageTop5, other.averageTop5),
  };
}
