import type { LapRow } from "@/lib/lapAnalysis";

/** Exclude laps faster than median × (1 − fastBand). Tight — catches grid/start-line timing errors. */
export const DEFAULT_LAP_OUTLIER_FAST_BAND = 0.12;

/** Exclude laps slower than median × (1 + slowBand). Looser — keeps plausible slow laps from inconsistency. */
export const DEFAULT_LAP_OUTLIER_SLOW_BAND = 0.35;

/** @deprecated Symmetric band kept for legacy callers/tests; prefer fastBand + slowBand. */
export const DEFAULT_LAP_OUTLIER_RELATIVE_BAND = 0.5;

/** Need at least this many finite non-zero laps before applying the rule. */
export const DEFAULT_MIN_LAPS_FOR_OUTLIER_RULE = 4;

/** Never leave fewer than this many included laps (lapNumber !== 0, finite, isIncluded). */
export const DEFAULT_MIN_INCLUDED_AFTER_AUTO_EXCLUDE = 2;

function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Auto-set `isIncluded: false` for laps outside asymmetric bands around the session median.
 * Fast outliers (impossible laps) use a tighter floor; slow outliers use a looser ceiling.
 * Lap 0 is never used for the median and is left unchanged. Re-includes the closest excluded
 * laps if the first pass would leave too few included laps.
 */
export function applyMedianBandAutoExclude(
  rows: LapRow[],
  opts?: {
    fastBand?: number;
    slowBand?: number;
    /** @deprecated When set without fastBand/slowBand, applies symmetric band to both sides. */
    band?: number;
    minLaps?: number;
    minIncluded?: number;
  }
): LapRow[] {
  const legacyBand = opts?.band ?? DEFAULT_LAP_OUTLIER_RELATIVE_BAND;
  const fastBand =
    opts?.fastBand ?? (opts?.band != null ? legacyBand : DEFAULT_LAP_OUTLIER_FAST_BAND);
  const slowBand =
    opts?.slowBand ?? (opts?.band != null ? legacyBand : DEFAULT_LAP_OUTLIER_SLOW_BAND);
  const minLaps = opts?.minLaps ?? DEFAULT_MIN_LAPS_FOR_OUTLIER_RULE;
  const minIncluded = opts?.minIncluded ?? DEFAULT_MIN_INCLUDED_AFTER_AUTO_EXCLUDE;

  const next = rows.map((r) => ({ ...r }));

  const statIndices: number[] = [];
  const statTimes: number[] = [];
  for (let i = 0; i < next.length; i++) {
    const r = next[i]!;
    if (r.lapNumber === 0) continue;
    if (typeof r.lapTimeSeconds !== "number" || !Number.isFinite(r.lapTimeSeconds)) continue;
    statIndices.push(i);
    statTimes.push(r.lapTimeSeconds);
  }

  if (statTimes.length < minLaps) return next;

  const sortedTimes = [...statTimes].sort((a, b) => a - b);
  const med = medianSorted(sortedTimes);
  if (!Number.isFinite(med) || med <= 0) return next;

  const low = med * (1 - fastBand);
  const high = med * (1 + slowBand);

  for (const i of statIndices) {
    const t = next[i]!.lapTimeSeconds;
    const outlier = t < low || t > high;
    next[i] = { ...next[i]!, isIncluded: outlier ? false : true };
  }

  const countIncluded = (): number =>
    next.filter(
      (l) =>
        l.lapNumber !== 0 &&
        l.isIncluded &&
        typeof l.lapTimeSeconds === "number" &&
        Number.isFinite(l.lapTimeSeconds)
    ).length;

  if (countIncluded() >= minIncluded) return next;

  const excludedIdx = statIndices.filter((i) => !next[i]!.isIncluded);
  excludedIdx.sort(
    (a, b) =>
      Math.abs(next[a]!.lapTimeSeconds - med) - Math.abs(next[b]!.lapTimeSeconds - med)
  );

  for (const i of excludedIdx) {
    if (countIncluded() >= minIncluded) break;
    next[i] = { ...next[i]!, isIncluded: true };
  }

  return next;
}
