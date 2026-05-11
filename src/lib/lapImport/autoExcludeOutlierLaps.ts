import type { LapRow } from "@/lib/lapAnalysis";

/** Relative half-width around median: exclude laps outside `[median * (1 - band), median * (1 + band)]`. */
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
 * Auto-set `isIncluded: false` for laps whose time lies outside a symmetric relative band
 * around the session median (per driver list). Lap 0 is never used for the median and is
 * left unchanged. Re-includes the closest excluded laps if the first pass would leave too
 * few included laps.
 */
export function applyMedianBandAutoExclude(
  rows: LapRow[],
  opts?: {
    band?: number;
    minLaps?: number;
    minIncluded?: number;
  }
): LapRow[] {
  const band = opts?.band ?? DEFAULT_LAP_OUTLIER_RELATIVE_BAND;
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

  const low = med * (1 - band);
  const high = med * (1 + band);

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
