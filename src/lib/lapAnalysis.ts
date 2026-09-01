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
  /**
   * Spread of the included laps in SECONDS (standard deviation) — lower is tidier.
   *
   * The app carries two consistency languages and they are not interchangeable: this one,
   * and `consistencyScore` (100 − CV%, higher is better) which the FIELD tab, the dashboard
   * and the Engineer quote. The rule is per-surface, not global — one sheet, one language.
   * The lap sheet's own stat tile has always read "±0.23", so a column header reading
   * "98.44%" three centimetres below it was two answers to one question on one screen.
   */
  consistencyStdDev: number | null;
  /** Seconds per lap the run drifted — see `getFadePerLap`. Positive = gave time away. */
  fadePerLap: number | null;
  /** The driver's stored 5-minute window start for their own run — see `readFiveMinStartLap`. */
  fiveMinStartLap?: number | null;
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

/** Fastest N included laps (lap #0 and excluded omitted), sorted fastest-first. */
export function getFastestIncludedLaps(laps: LapRow[], n: number): LapRow[] {
  if (n < 1) return [];
  return [...getIncludedLaps(laps)]
    .filter((l) => l.lapTimeSeconds > 0)
    .sort((a, b) => a.lapTimeSeconds - b.lapTimeSeconds)
    .slice(0, n);
}

export function formatLapRowBreakdown(laps: LapRow[]): string {
  if (laps.length === 0) return "—";
  return laps.map((l) => `L${l.lapNumber} ${l.lapTimeSeconds.toFixed(3)}s`).join(" · ");
}

/**
 * How far off the best lap a lap can be and still count as driven rather than survived.
 *
 * Fade needs this cut and cannot lean on the run form's exclusions to provide it.
 * Exclusions are a thing the DRIVER does to their OWN run; the whole point of the
 * analysis surface is reading sessions nobody here drove — a stranger's heat off LiveRC
 * arrives with every marshal call still in it, and one 40s lap in a 15s class doesn't
 * shift a mean, it *is* the mean of its third.
 *
 * 1.25× is deliberately loose. A bad-but-driven lap (traffic, a wide line, a tap) lands
 * inside it; getting stood back up does not.
 *
 * Consistency deliberately does NOT use this — it stays on plain included laps, matching
 * the stat tile above the grid, which has always read the same spread the same way.
 */
export const CLEAN_LAP_MAX_RATIO_TO_BEST = 1.25;

/**
 * Minimum clean laps, after the out-lap is dropped, before fade means anything. Six laps
 * is fifteen pairs for the median to stand on; under that the figure is "—", not zero.
 */
export const MIN_LAPS_FOR_FADE = 6;

/** Laps in one rolling window of the fade profile — a third of a typical 5-minute run. */
export const FADE_PROFILE_WINDOW = 6;

/**
 * Clean laps before the rolling profile is drawn at all. Under ten laps the profile is
 * four windows of six laps sharing most of their laps: a picture of the noise, not the run.
 */
export const MIN_LAPS_FOR_FADE_PROFILE = 10;

/**
 * Included laps with the crashes cut out, in lap order.
 *
 * Lap order, not the order the array happened to arrive in: fade reads the run as a
 * sequence, so the sequence IS the measurement.
 */
export function getCleanLapsInOrder(laps: LapRow[]): LapRow[] {
  const included = getIncludedLaps(laps).filter((l) => l.lapTimeSeconds > 0);
  if (included.length === 0) return [];
  const best = Math.min(...included.map((l) => l.lapTimeSeconds));
  const ceiling = best * CLEAN_LAP_MAX_RATIO_TO_BEST;
  return included
    .filter((l) => l.lapTimeSeconds <= ceiling)
    .sort((a, b) => a.lapNumber - b.lapNumber);
}

/**
 * The laps fade is measured over: clean laps, minus the out-lap.
 *
 * The first lap by number is the run's out-lap — a standing start, a staggered release, the
 * car still coming up to temperature — and it is not the car going away, whichever way it
 * reads. It is dropped by lap number, not by position in the clean set, so a lap 1 the
 * crash cut already removed doesn't cost lap 2 as well.
 */
export function getFadeLapsInOrder(laps: LapRow[]): LapRow[] {
  const included = getIncludedLaps(laps).filter((l) => l.lapTimeSeconds > 0);
  if (included.length === 0) return [];
  const outLap = Math.min(...included.map((l) => l.lapNumber));
  return getCleanLapsInOrder(laps).filter((l) => l.lapNumber !== outLap);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Seconds per lap between every pair of laps, and the median of all of them — the
 * Theil–Sen slope. The line the middle pair draws, not the line the average pair draws.
 */
function medianPairwiseSlope(laps: LapRow[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < laps.length; i++) {
    for (let j = i + 1; j < laps.length; j++) {
      const dx = laps[j]!.lapNumber - laps[i]!.lapNumber;
      if (dx > 0) slopes.push((laps[j]!.lapTimeSeconds - laps[i]!.lapTimeSeconds) / dx);
    }
  }
  return median(slopes);
}

/**
 * How many seconds per lap the run drifted, over the whole run.
 *
 * Positive = the run got slower, which is the tyre going away, the pack sagging, or the
 * driver tiring — three things a race engineer treats very differently but all of which
 * start as this one number being positive. Negative = came to the driver.
 *
 * Measured as the median of every pairwise "seconds per lap" between two laps of the run
 * (Theil–Sen). Chosen over the first-third/last-third difference it replaced (2026-08-27)
 * after both were run over 292 real runs: they agreed on 248, and on every disagreement
 * read by eye the thirds figure was the one that was wrong — a flat run with four scrappy
 * laps that happened to land in its closing third read as +0.87s of fade. A median of
 * pairs can't be pulled by a few bad laps, it uses every lap rather than two ends, and it
 * is a RATE, so a 12-lap heat and a 30-lap main read on one scale. Multiply by the laps
 * to get the felt number: `fadeOverRunSeconds`.
 *
 * The "best three of each half" idea was rejected first: the laps a driver is best at are
 * exactly the laps that don't show wear.
 */
export function getFadePerLap(laps: LapRow[]): number | null {
  const fadeLaps = getFadeLapsInOrder(laps);
  if (fadeLaps.length < MIN_LAPS_FOR_FADE) return null;
  return medianPairwiseSlope(fadeLaps);
}

export type FadeProfilePoint = {
  /** First and last lap number of the window the rate was read over. */
  fromLap: number;
  toLap: number;
  /** Seconds per lap across that window, signed like `getFadePerLap`. */
  ratePerLap: number;
};

/**
 * The fade rate over every `FADE_PROFILE_WINDOW`-lap stretch of the run, in order — the
 * picture of WHEN the run went away, which one rate over the whole run can't carry.
 *
 * This is the whole story the app tells about onset. A "flat, then it goes off at lap N"
 * fit was tried on the same 292 runs and fired on seven, every one of them two ugly
 * closing laps of a qualifier being read as the tyre going — with 12–16 laps in a run
 * there is nothing to tell a driver's mistakes from the car's decline. The rolling rate is
 * just the data, so it can't make that claim; a reader sees a rate that builds and stays
 * built and draws the conclusion themselves. Empty under `MIN_LAPS_FOR_FADE_PROFILE`.
 */
export function getFadeProfile(laps: LapRow[]): FadeProfilePoint[] {
  const fadeLaps = getFadeLapsInOrder(laps);
  if (fadeLaps.length < MIN_LAPS_FOR_FADE_PROFILE) return [];
  const out: FadeProfilePoint[] = [];
  for (let i = 0; i + FADE_PROFILE_WINDOW <= fadeLaps.length; i++) {
    const window = fadeLaps.slice(i, i + FADE_PROFILE_WINDOW);
    out.push({
      fromLap: window[0]!.lapNumber,
      toLap: window[window.length - 1]!.lapNumber,
      ratePerLap: medianPairwiseSlope(window),
    });
  }
  return out;
}

/** The rate spread back over the laps it was read on: "≈ +0.6 s over the run". */
export function fadeOverRunSeconds(laps: LapRow[]): number | null {
  const rate = getFadePerLap(laps);
  if (rate == null) return null;
  const fadeLaps = getFadeLapsInOrder(laps);
  return rate * (fadeLaps[fadeLaps.length - 1]!.lapNumber - fadeLaps[0]!.lapNumber);
}

/** "+0.04 s/lap" — two places, signed, the unit on it. Null reads "—". */
export function formatFadePerLap(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  const rounded = Math.abs(rate) < 0.005 ? 0 : rate;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(2)} s/lap`;
}

/** The hover line under a fade figure: "≈ +0.6 s over the run". */
export function formatFadeOverRun(seconds: number | null): string | undefined {
  if (seconds == null || !Number.isFinite(seconds)) return undefined;
  const rounded = Math.abs(seconds) < 0.05 ? 0 : seconds;
  return `≈ ${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)} s over the run`;
}

export function buildComparisonSeries(
  id: string,
  label: string,
  sourceType: "run" | "imported",
  laps: LapRow[],
  opts?: { fiveMinStartLap?: number | null }
): ComparisonSeries {
  return {
    id,
    label,
    sourceType,
    laps,
    bestLap: getBestLap(laps),
    avgTop5: getAverageTopN(laps, 5),
    avgTop10: getAverageTopN(laps, 10),
    consistencyStdDev: analyzeLapRows(laps).consistencyStdDev,
    fadePerLap: getFadePerLap(laps),
    fiveMinStartLap: opts?.fiveMinStartLap ?? null,
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
 * Floor for the adaptive tint range. Without it a metronomic run — every lap within a
 * few hundredths — would stretch those hundredths across the full colour ramp and paint
 * a screaming grid over differences nobody can drive to.
 */
export const DELTA_TINT_MIN_RANGE = 0.08;

/**
 * Tint range (seconds) for one grid, derived from the deltas actually on screen.
 *
 * The fixed 1.0s range this replaces was calibrated for a spread real lap data never
 * has: in a 14.8s class, lap-to-lap deltas run 0.03–0.25s, so every meaningful lap
 * landed in the bottom sixth of the ramp (a 0.1s delta tinted at 10% opacity) and the
 * only thing that ever coloured strongly was a crash lap — usually excluded anyway.
 * Six different laps came out as one flat wash.
 *
 * p90 rather than max so a single wild lap that survived exclusion can't flatten the
 * other twenty-three, clamped both ends so the ramp stays honest at either extreme.
 * Callers pass only INCLUDED laps — an excluded 18s lap is not part of the comparison
 * and must not set the scale for the laps that are.
 */
export function resolveDeltaTintRange(deltas: Iterable<number>): number {
  const abs = [...deltas]
    .filter((d) => Number.isFinite(d))
    .map((d) => Math.abs(d))
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (abs.length === 0) return DELTA_TINT_MIN_RANGE;
  const idx = Math.max(0, Math.min(abs.length - 1, Math.ceil(abs.length * 0.9) - 1));
  return Math.min(DELTA_MAX_ABS_RANGE, Math.max(DELTA_TINT_MIN_RANGE, abs[idx]!));
}

/**
 * Smooth opacity gradient for lap-cell tints (comparison columns only — the
 * target is the baseline and stays flat).
 * delta = cell − anchor: positive = slower → loss red (#E5644E), negative =
 * faster → gain green (#4FD089), the north-star data-delta semantics.
 * alpha = 0.06 + normalized * 0.44 where normalized = min(|delta| / maxAbs, 1)
 * — capped at 0.5 so light mono text stays legible over the tint.
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
  const alpha = 0.06 + normalized * 0.44;
  if (absDelta < 1e-9) {
    return { backgroundColor: "rgba(128, 128, 128, 0.06)" };
  }
  if (delta > 0) {
    return { backgroundColor: `rgba(229, 100, 78, ${alpha})` };
  }
  return { backgroundColor: `rgba(79, 208, 137, ${alpha})` };
}

export type SummaryMetricDeltas = {
  bestDelta: number | null;
  avgTop5Delta: number | null;
  avgTop10Delta: number | null;
  /** Seconds, signed like the lap rows: positive = this column wandered more. */
  consistencyDelta: number | null;
  /** Seconds per lap, signed like the lap rows: positive = this column faded harder. */
  fadePerLapDelta: number | null;
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
    consistencyDelta:
      target.consistencyStdDev != null && comparison.consistencyStdDev != null
        ? comparison.consistencyStdDev - target.consistencyStdDev
        : null,
    fadePerLapDelta:
      target.fadePerLap != null && comparison.fadePerLap != null
        ? comparison.fadePerLap - target.fadePerLap
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

/**
 * Picker APIs: resolve the exclusion-aware best lap onto `bestLapSeconds`
 * (stored column when set, else recomputed from lapSession flags) and drop the
 * heavy `lapSession` blob from the payload — picker lines only need the number.
 */
export function withIncludedBestLapForPicker<
  T extends { lapTimes: unknown; lapSession: unknown; bestLapSeconds: number | null },
>(run: T): Omit<T, "lapSession"> {
  const { lapSession, ...rest } = run;
  return {
    ...rest,
    bestLapSeconds:
      run.bestLapSeconds ??
      computeIncludedLapMetricsFromRun({ lapTimes: run.lapTimes, lapSession }).bestLap,
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

/**
 * A five-minute window scored the way a timing loop posts a result: laps first,
 * then the clock when the lap that crossed five minutes was completed. "13 laps,
 * 5:12.345" — the number every RC driver ranks themselves by.
 */
export type FiveMinuteStint = {
  /** Laps completed when the window's clock passed five minutes — the crossing lap counts. */
  lapCount: number;
  /** Wall-clock seconds when that crossing lap was completed; ≥ the window by construction. */
  seconds: number;
  /** First lap inside the window — the one handle the window has. */
  startLapNumber: number;
  /** Last lap inside the window (the one that crossed five minutes), for highlighting. */
  endLapNumber: number;
};

/** The race length the figure answers for — "what's my 5-minute pace". */
export const FIVE_MIN_STINT_WINDOW_SECONDS = 300;

/**
 * Best consecutive five minutes of a session — ONE rule for every source and
 * session type (founder call, 2026-08-31):
 *
 * - The window slides over the laps AS DRIVEN. Excluded laps still count: a stint
 *   is wall clock, and a crash took real time — the best window simply settles
 *   where the driver didn't crash. This is deliberately unlike every other metric
 *   here, which filters excluded laps out before doing anything.
 * - Lap #0 (the out-lap) is dropped, as it is everywhere else; a window may start
 *   on any real lap.
 * - The lap in progress at 5:00 counts when completed (the timing-loop rule), so
 *   `seconds` lands past the window, never at it.
 * - Best = most laps; on equal laps, least time. The LiveRC ranking rule.
 * - A session whose laps never reach five minutes has no figure — null, never a
 *   padded or scaled-up number.
 *
 * On a real 5-minute race the window has nowhere to slide — starting after lap 1
 * leaves under five minutes of laps — so the figure reproduces the posted result
 * without any race/practice branch.
 */
export function getBestFiveMinuteStint(
  laps: LapRow[],
  windowSeconds: number = FIVE_MIN_STINT_WINDOW_SECONDS
): FiveMinuteStint | null {
  const drive = drivenLapsInOrder(laps);
  let best: FiveMinuteStint | null = null;
  for (let i = 0; i < drive.length; i++) {
    const cand = windowFromIndex(drive, i, windowSeconds);
    // Ran out of laps before the clock reached the window; every later start is
    // a suffix of this one, so nothing further can qualify either.
    if (cand == null) break;
    if (
      best == null ||
      cand.lapCount > best.lapCount ||
      (cand.lapCount === best.lapCount && cand.seconds < best.seconds)
    ) {
      best = cand;
    }
  }
  return best;
}

/**
 * The window placed BY HAND: the driver chose the start lap and the clock does
 * the rest (founder call, 2026-09-01 — "per run, auto should be best consecutive
 * 5 mins, with option to change"). Same wall-clock scoring as the best window;
 * null when there aren't five minutes of laps from that start, or the lap
 * doesn't exist — a stale choice must fall back to auto, never invent a figure.
 */
export function getFiveMinuteStintStartingAt(
  laps: LapRow[],
  startLapNumber: number,
  windowSeconds: number = FIVE_MIN_STINT_WINDOW_SECONDS
): FiveMinuteStint | null {
  const drive = drivenLapsInOrder(laps);
  const i = drive.findIndex((l) => l.lapNumber === startLapNumber);
  if (i < 0) return null;
  return windowFromIndex(drive, i, windowSeconds);
}

/** Real laps in driven order — lap #0 dropped, excluded laps KEPT (wall clock). */
function drivenLapsInOrder(laps: LapRow[]): Array<{ lapNumber: number; lapTimeSeconds: number }> {
  return [...laps]
    .filter(
      (l) =>
        l.lapNumber !== 0 &&
        typeof l.lapTimeSeconds === "number" &&
        Number.isFinite(l.lapTimeSeconds) &&
        l.lapTimeSeconds > 0
    )
    .sort((a, b) => a.lapNumber - b.lapNumber);
}

/** Timing-loop score of the window opening at drive[i]; null if the laps run out first. */
function windowFromIndex(
  drive: Array<{ lapNumber: number; lapTimeSeconds: number }>,
  i: number,
  windowSeconds: number
): FiveMinuteStint | null {
  let seconds = 0;
  for (let j = i; j < drive.length; j++) {
    seconds += drive[j]!.lapTimeSeconds;
    if (seconds >= windowSeconds) {
      return {
        lapCount: j - i + 1,
        seconds,
        startLapNumber: drive[i]!.lapNumber,
        endLapNumber: drive[j]!.lapNumber,
      };
    }
  }
  return null;
}

/**
 * The driver's stored window choice, off `Run.lapSession` — an optional
 * `fiveMinStartLap` on the version-1 blob (additive; older readers ignore it).
 * Null = auto (best window). Validity against the CURRENT laps is the reader's
 * problem by design: laps can be re-imported after the choice was made, so
 * surfaces run it through `getFiveMinuteStintStartingAt` and fall back to auto.
 */
export function readFiveMinStartLap(lapSession: unknown): number | null {
  if (!lapSession || typeof lapSession !== "object") return null;
  const o = lapSession as Record<string, unknown>;
  if (o.version !== 1) return null;
  const raw = o.fiveMinStartLap;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : null;
}

/**
 * The stint a surface should DISPLAY for a run: the driver's chosen window when
 * one is stored and still valid, otherwise the best window. One helper so the
 * run card and the lap sheet can never disagree about the same run.
 */
export function getDisplayFiveMinuteStint(
  laps: LapRow[],
  chosenStartLap: number | null | undefined
): FiveMinuteStint | null {
  if (chosenStartLap != null) {
    const chosen = getFiveMinuteStintStartingAt(laps, chosenStartLap);
    if (chosen != null) return chosen;
  }
  return getBestFiveMinuteStint(laps);
}

export type IncludedLapDashboardMetrics = {
  lapCount: number;
  /** Sum of included lap times (seconds). */
  stintSeconds: number | null;
  /** Best consecutive five minutes, timing-loop scored — see `getBestFiveMinuteStint`. */
  fiveMinStint: FiveMinuteStint | null;
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

/** Canonical precision for consistency score everywhere it is shown or serialized. */
export function roundConsistencyScore(score: number): number {
  return Math.round(score * 100) / 100;
}

/** UI: RC consistency score (100 − CV %) with exactly two decimal places. */
export function formatConsistencyScorePercent(score: number): string {
  return `${roundConsistencyScore(score).toFixed(2)}%`;
}

/** Single pass over included laps for compact run-summary UI. */
export function getIncludedLapDashboardMetrics(laps: LapRow[]): IncludedLapDashboardMetrics {
  const times = getIncludedLaps(laps).map((l) => l.lapTimeSeconds);
  if (times.length === 0) {
    return {
      lapCount: 0,
      stintSeconds: null,
      fiveMinStint: null,
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
  const consistencyScore =
    cvPercent != null ? roundConsistencyScore(computeConsistencyFromCV(cvPercent)) : null;
  return {
    lapCount: times.length,
    stintSeconds,
    // From the RAW rows, not `times`: the window is wall clock, so excluded laps count.
    fiveMinStint: getBestFiveMinuteStint(laps),
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

/** Minimum included laps before showing mistake count (display-only metric). */
export const MIN_LAPS_FOR_MISTAKES = 6;

/** Floor for mistake threshold (seconds slower than median). */
export const MISTAKE_MIN_ABSOLUTE_SEC = 0.5;

/** Scale session IQR into the adaptive threshold — loose stints need a larger gap. */
export const MISTAKE_IQR_MULTIPLIER = 2;

export type LapMistake = {
  lapNumber: number;
  lapTimeSeconds: number;
  /** Seconds slower than session median (included laps). */
  deltaSec: number;
};

export type MistakeLapAnalysis = {
  eligible: boolean;
  mistakeCount: number;
  mistakes: LapMistake[];
  medianSec: number | null;
  thresholdSec: number | null;
  iqrSec: number | null;
};

/** Linear-interpolated percentile over an ascending array. Exported for the trend spread view. */
export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = sorted.length / 2;
  return sorted.length % 2 === 1
    ? sorted[Math.floor(mid)]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function iqrSorted(sorted: number[]): number {
  if (sorted.length < 2) return 0;
  const p25 = percentileSorted(sorted, 0.25);
  const p75 = percentileSorted(sorted, 0.75);
  if (!Number.isFinite(p25) || !Number.isFinite(p75)) return 0;
  return Math.max(0, p75 - p25);
}

/**
 * Slow-only “mistake” laps for session view: slower than median by more than
 * max(0.5s, 2× IQR of included laps). Display-only — does not change best/avg.
 */
export function computeMistakeLaps(
  laps: LapRow[],
  opts?: {
    minLaps?: number;
    minAbsoluteSec?: number;
    iqrMultiplier?: number;
  }
): MistakeLapAnalysis {
  const minLaps = opts?.minLaps ?? MIN_LAPS_FOR_MISTAKES;
  const minAbsoluteSec = opts?.minAbsoluteSec ?? MISTAKE_MIN_ABSOLUTE_SEC;
  const iqrMultiplier = opts?.iqrMultiplier ?? MISTAKE_IQR_MULTIPLIER;

  const included = getIncludedLaps(laps);
  if (included.length < minLaps) {
    return {
      eligible: false,
      mistakeCount: 0,
      mistakes: [],
      medianSec: null,
      thresholdSec: null,
      iqrSec: null,
    };
  }

  const sortedTimes = [...included.map((l) => l.lapTimeSeconds)].sort((a, b) => a - b);
  const medianSec = medianSorted(sortedTimes);
  const iqrSec = iqrSorted(sortedTimes);
  if (!Number.isFinite(medianSec)) {
    return {
      eligible: true,
      mistakeCount: 0,
      mistakes: [],
      medianSec: null,
      thresholdSec: null,
      iqrSec,
    };
  }

  const thresholdSec = Math.max(minAbsoluteSec, iqrMultiplier * iqrSec);
  const mistakes: LapMistake[] = [];

  for (const lap of included) {
    const deltaSec = lap.lapTimeSeconds - medianSec;
    if (deltaSec > thresholdSec) {
      mistakes.push({
        lapNumber: lap.lapNumber,
        lapTimeSeconds: lap.lapTimeSeconds,
        deltaSec,
      });
    }
  }

  mistakes.sort((a, b) => a.lapNumber - b.lapNumber);

  return {
    eligible: true,
    mistakeCount: mistakes.length,
    mistakes,
    medianSec,
    thresholdSec,
    iqrSec,
  };
}

export function formatMistakeLapDetail(m: LapMistake): string {
  return `L${m.lapNumber} +${m.deltaSec.toFixed(2)}s`;
}

export function formatMistakeAnalysisSummary(analysis: MistakeLapAnalysis): string {
  if (!analysis.eligible) {
    return `Need at least ${MIN_LAPS_FOR_MISTAKES} included laps`;
  }
  if (analysis.thresholdSec == null || analysis.medianSec == null) {
    return "Could not compute mistake threshold";
  }
  if (analysis.mistakeCount === 0) {
    return `No laps slower than median + ${analysis.thresholdSec.toFixed(2)}s (median ${analysis.medianSec.toFixed(3)}s)`;
  }
  const list = analysis.mistakes.map(formatMistakeLapDetail).join(" · ");
  return `${list} — slower than median ${analysis.medianSec.toFixed(3)}s (threshold +${analysis.thresholdSec.toFixed(2)}s)`;
}

/* ── Field sheet ─────────────────────────────────────────────────────────────
 * Whole-field view of one imported multi-driver session (Sessions expanded
 * view, FIELD tab): every entrant on Best / Pace / Consistency / Mistakes, with
 * competition ranks so "P4 on one-lap speed, P9 on race pace" reads straight off.
 *
 * Takes already-built `LapRow[]` per driver rather than raw lap arrays, for two
 * reasons: `applyMedianBandAutoExclude` lives in `lapImport/` and imports
 * `LapRow` from this module (importing it back would be a cycle), and — more
 * importantly — the caller must be free to build the two sides differently.
 * See `computeFieldSheet`.
 * ────────────────────────────────────────────────────────────────────────── */

/** Included-lap floor for a driver to be ranked. Below it a crashed-out run would top the pace column. */
export const MIN_LAPS_FOR_FIELD_RANK = 5;

/** Ties closer than this share a rank — matches `rankLowerIsBetter` in `lapImport/importedTimingFieldStatsForEngineer.ts`. */
export const FIELD_RANK_TIE_EPSILON = 1e-9;

export type FieldSheetDriverInput = {
  id: string;
  name: string;
  /** 1-based classification position from the timing provider (most laps, then lowest total time). */
  position: number;
  isUser: boolean;
  /** Lap rows already cleaned by the caller — see `computeFieldSheet` on why the two sides differ. */
  rows: LapRow[];
};

export type FieldSheetRow = {
  id: string;
  name: string;
  position: number;
  isUser: boolean;
  lapCount: number;
  /** Sum of included lap times (seconds). */
  stintSeconds: number | null;
  bestLap: number | null;
  avgTop5: number | null;
  /** Mean of the 10 fastest included laps — the metric the Engineer already ranks on. */
  pace: number | null;
  median: number | null;
  consistencyScore: number | null;
  /** Null when the driver has too few laps for the mistake rule (`MIN_LAPS_FOR_MISTAKES`). */
  mistakeCount: number | null;
  /** Seconds per lap the driver drifted (`getFadePerLap`); null under `MIN_LAPS_FOR_FADE`. */
  fadePerLap: number | null;
  /** Competition ranks (ties share a rank); null while `eligible` is false. */
  rankByBest: number | null;
  rankByPace: number | null;
  rankByConsistency: number | null;
  /** Has at least `MIN_LAPS_FOR_FIELD_RANK` included laps, so its metrics are comparable. */
  eligible: boolean;
};

/**
 * Arithmetic mean of each metric across the field — what the stat wells show while
 * the FIELD tab is up, in place of one driver's figures.
 *
 * Averaged over RANKED drivers only: a car that crashed out on lap 3 would drag
 * every figure, the same reason it's kept out of the ranking. Each metric averages
 * independently over the drivers that have it, so one driver missing a mistake
 * count doesn't blank the rest.
 */
export type FieldAverages = {
  /** Ranked drivers the averages are taken over. */
  driverCount: number;
  lapCount: number | null;
  stintSeconds: number | null;
  bestLap: number | null;
  avgTop5: number | null;
  avgTop10: number | null;
  median: number | null;
  consistencyScore: number | null;
  mistakeCount: number | null;
  fadePerLap: number | null;
};

export type FieldSheet = {
  /** Every entrant, in classification order. */
  rows: FieldSheetRow[];
  you: FieldSheetRow | null;
  /** The ranked driver one place ahead of you on pace — your next target. */
  nextAheadOnPace: FieldSheetRow | null;
  /** Set instead of `nextAheadOnPace` when you have the fastest pace in the field. */
  runnerUpOnPace: FieldSheetRow | null;
  /** `theirPace − yourPace` for whichever of the two above is set: negative = they're faster. */
  paceGapSeconds: number | null;
  /** How many entrants had enough laps to be ranked. */
  rankedCount: number;
  /** Field-wide means over the ranked drivers. */
  averages: FieldAverages;
};

/**
 * Competition rank over a lower-is-better metric: ties share a rank and the next
 * value skips (1, 2, 2, 4). Returns no ranks at all below two finite values,
 * because "P1 of 1" is not information.
 *
 * Deliberately mirrors `rankLowerIsBetter` in
 * `lapImport/importedTimingFieldStatsForEngineer.ts` (server-only, so it can't be
 * imported here) — that one is the semantic the Engineer's prompt copy already
 * quotes, so the two must stay in step.
 */
function ranksLowerIsBetter(entries: Array<{ id: string; value: number | null }>): Map<string, number> {
  const out = new Map<string, number>();
  const finite = entries.filter(
    (e): e is { id: string; value: number } => e.value != null && Number.isFinite(e.value)
  );
  if (finite.length < 2) return out;
  for (const mine of finite) {
    const faster = finite.filter((x) => x.value < mine.value - FIELD_RANK_TIE_EPSILON).length;
    out.set(mine.id, faster + 1);
  }
  return out;
}

/**
 * Per-driver metrics + ranks for the field sheet.
 *
 * IMPORTANT — the two sides of `drivers` are built differently on purpose:
 * competitors' rows come from the imported payload through
 * `applyMedianBandAutoExclude` (a heuristic, since their laps can't be inspected),
 * while YOUR row must come from your own run via `primaryLapRowsFromRun` — which
 * carries your manual lap exclusions and no auto-exclude. Build your row from the
 * payload instead and the sheet silently disagrees with the stat wells rendered
 * directly above it whenever you've edited a lap.
 */
export function computeFieldSheet(drivers: FieldSheetDriverInput[]): FieldSheet {
  const base = drivers.map((d) => {
    const dash = getIncludedLapDashboardMetrics(d.rows);
    const mistakes = computeMistakeLaps(d.rows);
    return { input: d, dash, mistakes, eligible: dash.lapCount >= MIN_LAPS_FOR_FIELD_RANK };
  });

  // Only ranked drivers enter the ranking, so a 3-lap crash-out can't take P1 on pace.
  const rankable = base.filter((b) => b.eligible);
  const bestRanks = ranksLowerIsBetter(
    rankable.map((b) => ({ id: b.input.id, value: b.dash.bestLap }))
  );
  const paceRanks = ranksLowerIsBetter(
    rankable.map((b) => ({ id: b.input.id, value: b.dash.avgTop10 }))
  );
  // Consistency is higher-is-better, so rank the negated score.
  const consistencyRanks = ranksLowerIsBetter(
    rankable.map((b) => ({
      id: b.input.id,
      value: b.dash.consistencyScore == null ? null : -b.dash.consistencyScore,
    }))
  );

  const rows: FieldSheetRow[] = base
    .map((b) => ({
      id: b.input.id,
      name: b.input.name,
      position: b.input.position,
      isUser: b.input.isUser,
      lapCount: b.dash.lapCount,
      stintSeconds: b.dash.stintSeconds,
      bestLap: b.dash.bestLap,
      avgTop5: b.dash.avgTop5,
      pace: b.dash.avgTop10,
      median: b.dash.median,
      consistencyScore: b.dash.consistencyScore,
      mistakeCount: b.mistakes.eligible ? b.mistakes.mistakeCount : null,
      fadePerLap: getFadePerLap(b.input.rows),
      rankByBest: bestRanks.get(b.input.id) ?? null,
      rankByPace: paceRanks.get(b.input.id) ?? null,
      rankByConsistency: consistencyRanks.get(b.input.id) ?? null,
      eligible: b.eligible,
    }))
    .sort((a, b) => a.position - b.position);

  const you = rows.find((r) => r.isUser) ?? null;

  let nextAheadOnPace: FieldSheetRow | null = null;
  let runnerUpOnPace: FieldSheetRow | null = null;
  let paceGapSeconds: number | null = null;
  if (you != null && you.eligible && you.pace != null) {
    const byPace = rows
      .filter((r): r is FieldSheetRow & { pace: number } => r.eligible && r.pace != null)
      .sort((a, b) => a.pace - b.pace);
    const myIndex = byPace.findIndex((r) => r.id === you.id);
    if (myIndex > 0) {
      nextAheadOnPace = byPace[myIndex - 1]!;
      paceGapSeconds = nextAheadOnPace.pace! - you.pace;
    } else if (myIndex === 0 && byPace.length > 1) {
      // You have the fastest pace — show the margin over whoever is next instead.
      runnerUpOnPace = byPace[1]!;
      paceGapSeconds = runnerUpOnPace.pace! - you.pace;
    }
  }

  const ranked = rows.filter((r) => r.eligible);
  const meanOf = (pick: (r: FieldSheetRow) => number | null): number | null => {
    const xs = ranked.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
    return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const averages: FieldAverages = {
    driverCount: ranked.length,
    lapCount: meanOf((r) => r.lapCount),
    stintSeconds: meanOf((r) => r.stintSeconds),
    bestLap: meanOf((r) => r.bestLap),
    avgTop5: meanOf((r) => r.avgTop5),
    avgTop10: meanOf((r) => r.pace),
    median: meanOf((r) => r.median),
    consistencyScore: meanOf((r) => r.consistencyScore),
    mistakeCount: meanOf((r) => r.mistakeCount),
    fadePerLap: meanOf((r) => r.fadePerLap),
  };

  return {
    rows,
    you,
    nextAheadOnPace,
    runnerUpOnPace,
    paceGapSeconds,
    rankedCount: ranked.length,
    averages,
  };
}
