import {
  computeConsistencyFromCV,
  computeMistakeLaps,
  getAverageTopN,
  getIncludedLaps,
  percentileSorted,
  primaryLapRowsFromRun,
  roundConsistencyScore,
  analyzeLapRows,
  MIN_LAPS_FOR_MISTAKES,
  MISTAKE_IQR_MULTIPLIER,
  MISTAKE_MIN_ABSOLUTE_SEC,
} from "@/lib/lapAnalysis";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { calendarYmdInTimeZone } from "@/lib/formatDate";
import type { RunTireIndicator } from "@/lib/runs/tireSetChange";
import { setupChangedRowsSincePrevious } from "@/lib/setupCompare/changedSincePrevious";
import { isExcludedSetupChangeKey } from "@/lib/setupCompare/setupChangeNoise";

/**
 * Analysis debrief home model — pure types + shaping helpers shared by the
 * server loader (`loadAnalysisHomeModel`) and the `/analysis` client cards.
 * Keep this file Prisma-free so `npx tsx src/lib/analysis/analysisHomeModel.test.ts`
 * runs offline.
 */

/** Per-run lap metrics for the trend chart + accordion (included laps only). */
export type AnalysisRunMetrics = {
  best: number | null;
  avgTop5: number | null;
  avgTop10: number | null;
  median: number | null;
  cleanLapCount: number;
  /** RC-style consistency (100 − CV), higher = steadier; null when too few laps. */
  consistencyScore: number | null;
  /** Count of mistake laps (IQR outliers); null when the run isn't mistake-eligible. */
  mistakeCount: number | null;
};

/**
 * Chassis-setup change vs the previous run on the same car — the wrench-row
 * marker on the trend chart. Present (non-null) only when at least one setup
 * field differed; tires / battery / additive are not setup-sheet fields and are
 * excluded (they live on the run itself and have their own tire row).
 */
export type RunSetupChangeIndicator = {
  /** Human labels of the fields that changed, e.g. ["Camber (Front)", "Toe (Rear)"]. */
  changedFieldLabels: string[];
};

/**
 * Lap distribution for one run — the box-and-whisker ("Spread") view of the
 * trend chart's Pace face. Quartiles over included laps.
 *
 * The whiskers are deliberately asymmetric rather than textbook Tukey: in RC a
 * fast tail is performance and a slow tail is a mistake, so the bottom whisker
 * always reaches the best lap (never clipped as an "outlier") while the top
 * whisker stops at the slowest lap that isn't a mistake. `mistakes` uses the
 * same rule as the Mistakes face, so "bad lap" means one thing across the card.
 */
export type AnalysisRunDistribution = {
  /** Fastest included lap — the bottom whisker, never clipped as an outlier. */
  best: number;
  p25: number;
  median: number;
  p75: number;
  /**
   * Slowest included lap that is not a mistake lap — the top whisker.
   *
   * NOT guaranteed to be ≥ `p75`. Quartiles span every included lap (mistakes
   * included) so the median here is the same number as the trend chart's Median
   * series; when a run's whole top quartile is mistakes, Q3 lands above the
   * slowest clean lap and there is simply no upper whisker to draw. Rare —
   * 2 of 146 mistake-eligible runs on the demo season — but real.
   */
  slowestClean: number;
  /** Mistake lap times (same rule as the Mistakes face), plotted as dots. */
  mistakes: number[];
};

/**
 * A run needs enough laps for the *whole* whisker rule to work, not merely enough
 * for quartiles to compute. Below `MIN_LAPS_FOR_MISTAKES` no lap can be
 * classified as a mistake, so a short run's crash lap would sit on its top
 * whisker while an identical lap in a longer run plots as a dot — the same
 * event drawn two different ways depending on stint length. Tying both to one
 * floor removes the special case, and Q1/Q3 off five samples was never worth
 * drawing anyway.
 */
export const MIN_LAPS_FOR_DISTRIBUTION = MIN_LAPS_FOR_MISTAKES;

export type AnalysisTrendRun = {
  id: string;
  carId: string | null;
  carName: string;
  /** Short x-axis label, e.g. "Q1", "A2", "R3". */
  shortLabel: string;
  createdAtIso: string;
  metrics: AnalysisRunMetrics;
  /** Lap distribution for the spread view; null when too few included laps. */
  distribution: AnalysisRunDistribution | null;
  /** Tire set + wear for this run; null when no set was logged. */
  tireIndicator: RunTireIndicator | null;
  /** Setup fields changed vs the previous run on this car; null when none / no baseline. */
  setupChange: RunSetupChangeIndicator | null;
};

export type AnalysisCarOption = { carId: string | null; carName: string };

export type AnalysisTrendModel = {
  /** "Winter Series R3" (event) or "Thu 3 Jul" (day). */
  scopeLabel: string;
  scopeKind: "event" | "day";
  /** Chronological (oldest → newest), all cars; lap-less runs omitted. */
  runs: AnalysisTrendRun[];
  carOptions: AnalysisCarOption[];
  defaultCarId: string | null;
};

export type AnalysisRecentRun = {
  id: string;
  /** Null → no wrench; the setup modal needs a car to resolve sheet + previous run. */
  carId: string | null;
  /** "Qualifying · Q2 · A800 RR" */
  title: string;
  /** "3/7/26, 4:20 pm · 18 clean laps" — formatted server-side. */
  subLabel: string;
  metrics: AnalysisRunMetrics;
  /** Best-lap delta vs the previous run with the same car + track (null when none). */
  bestDeltaVsPrev: number | null;
  /** Best lap equals the user's fastest at this car + track combo. */
  isTrackCarPb: boolean;
  /** Tire set + wear for this run; null when no set was logged. */
  tireIndicator: RunTireIndicator | null;
};

export type AnalysisVideoModel =
  | {
      kind: "job";
      jobId: string;
      title: string;
      subLabel: string;
    }
  | { kind: "none" };

export type AnalysisHomeModel = {
  /** Null when the user has no runs at all. */
  trend: AnalysisTrendModel | null;
  recentRuns: AnalysisRecentRun[];
  /**
   * Every run the driver has logged — RUNS, not session groups (Sessions groups
   * them by day / meeting, so the two numbers differ). The Recent-runs card's
   * door to Sessions quotes it: "148 runs" is a reason to tap, "all sessions"
   * on its own is an abstraction.
   */
  totalRunCount: number;
  video: AnalysisVideoModel;
};

/** Median of included lap times (seconds); null when empty. */
export function medianOf(times: number[]): number | null {
  const finite = times.filter((t) => Number.isFinite(t));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Metrics for one run. Prefers the materialized `bestLapSeconds` /
 * `avgTop5LapSeconds` columns (matches Sessions list behaviour) and falls back
 * to recomputing from the lap JSON for legacy rows; top-10 and median are
 * always computed from included laps.
 */
export function computeAnalysisRunMetrics(run: {
  lapTimes: unknown;
  lapSession?: unknown;
  bestLapSeconds?: number | null;
  avgTop5LapSeconds?: number | null;
}): AnalysisRunMetrics {
  const rows = primaryLapRowsFromRun(run);
  const included = getIncludedLaps(rows);
  const times = included.map((l) => l.lapTimeSeconds);
  const computedBest = times.length > 0 ? Math.min(...times) : null;

  const analysis = analyzeLapRows(rows);
  const cvPercent =
    analysis.averageLap != null && analysis.averageLap > 0 && analysis.consistencyStdDev != null
      ? (analysis.consistencyStdDev / analysis.averageLap) * 100
      : null;
  const consistencyScore =
    cvPercent != null ? roundConsistencyScore(computeConsistencyFromCV(cvPercent)) : null;
  const mistakes = computeMistakeLaps(rows);

  return {
    best: run.bestLapSeconds ?? computedBest,
    avgTop5: run.avgTop5LapSeconds ?? getAverageTopN(rows, 5),
    avgTop10: getAverageTopN(rows, 10),
    median: medianOf(times),
    cleanLapCount: included.length,
    consistencyScore,
    mistakeCount: mistakes.eligible ? mistakes.mistakeCount : null,
  };
}

/**
 * Lap distribution for one run's spread view — see `AnalysisRunDistribution`.
 * Null below `MIN_LAPS_FOR_DISTRIBUTION` included laps, which is the same floor
 * mistake detection uses, so every run that draws a box also gets the outlier
 * rule applied to it. Clean/mistake laps split on the threshold rather than on
 * membership of `computeMistakeLaps`'s list, so duplicate lap times are
 * classified independently.
 */
export function computeLapDistribution(run: {
  lapTimes: unknown;
  lapSession?: unknown;
}): AnalysisRunDistribution | null {
  const included = getIncludedLaps(primaryLapRowsFromRun(run));
  const sorted = included
    .map((lap) => lap.lapTimeSeconds)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (sorted.length < MIN_LAPS_FOR_DISTRIBUTION) return null;

  const median = medianOf(sorted)!;
  const p25 = percentileSorted(sorted, 0.25);
  const p75 = percentileSorted(sorted, 0.75);
  const iqr = Math.max(0, p75 - p25);
  const threshold = Math.max(MISTAKE_MIN_ABSOLUTE_SEC, MISTAKE_IQR_MULTIPLIER * iqr);

  const mistakes = sorted.filter((t) => t - median > threshold);
  // Every lap being a "mistake" is impossible (they can't all be above their own
  // median), but fall back to the full set rather than trusting that here.
  const clean = sorted.filter((t) => t - median <= threshold);
  const cleanOrAll = clean.length > 0 ? clean : sorted;

  return {
    best: sorted[0],
    p25,
    median,
    p75,
    slowestClean: cleanOrAll[cleanOrAll.length - 1],
    mistakes,
  };
}

/**
 * Short x-axis label: meeting session code ("Q1", "A2") wins; a short session
 * label is used verbatim; otherwise "R{order}" from chronological position.
 */
export function shortRunLabel(
  run: { meetingSessionCode?: string | null; sessionLabel?: string | null },
  chronologicalIndex: number
): string {
  const code = run.meetingSessionCode?.trim();
  if (code) return code;
  const label = run.sessionLabel?.trim();
  if (label && label.length <= 8) return label;
  return `R${chronologicalIndex + 1}`;
}

const SESSION_TYPE_FALLBACK_LABELS: Record<string, string> = {
  TESTING: "Testing",
  PRACTICE: "Practice",
  RACE_MEETING: "Race",
};

/** Accordion row title: session display (or session-type fallback) + car name. */
export function runRowTitle(run: {
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  carName?: string | null;
}): string {
  const session = formatRunSessionDisplay(run);
  const sessionPart =
    session !== "—" ? session : SESSION_TYPE_FALLBACK_LABELS[run.sessionType] ?? "Run";
  const car = run.carName?.trim();
  return car ? `${sessionPart} · ${car}` : sessionPart;
}

export type TrendScope =
  | { kind: "event"; eventId: string }
  | { kind: "day"; ymd: string };

/**
 * Chart scope: the latest run's event when it has one, otherwise that run's
 * calendar day in the display timezone. (An active event weekend therefore
 * charts the whole event; a plain test day charts that day; midweek you see
 * your most recent outing rather than an empty chart.)
 */
export function resolveTrendScope(
  latestRun: { eventId: string | null; createdAt: Date | string },
  timeZone: string
): TrendScope {
  if (latestRun.eventId) return { kind: "event", eventId: latestRun.eventId };
  return { kind: "day", ymd: calendarYmdInTimeZone(latestRun.createdAt, timeZone) };
}

export function runMatchesScope(
  run: { eventId: string | null; createdAt: Date | string },
  scope: TrendScope,
  timeZone: string
): boolean {
  if (scope.kind === "event") return run.eventId === scope.eventId;
  return calendarYmdInTimeZone(run.createdAt, timeZone) === scope.ymd;
}

/**
 * Best-lap delta for `runsDesc[index]` vs the next older run with the same
 * car + track (both non-null). Positive = slower, negative = faster.
 */
export function bestDeltaVsPreviousSameCarTrack(
  runsDesc: Array<{ carId: string | null; trackId: string | null; best: number | null }>,
  index: number
): number | null {
  const run = runsDesc[index];
  if (!run || run.best == null || !run.carId || !run.trackId) return null;
  for (let i = index + 1; i < runsDesc.length; i++) {
    const prev = runsDesc[i];
    if (prev.carId !== run.carId || prev.trackId !== run.trackId) continue;
    if (prev.best == null) return null;
    return run.best - prev.best;
  }
  return null;
}

/** Float-tolerant "this run's best IS the stored car+track minimum". */
export function isTrackCarPersonalBest(
  best: number | null,
  minBestAtTrackCar: number | null,
  epsilon = 1e-4
): boolean {
  if (best == null || minBestAtTrackCar == null) return false;
  return best <= minBestAtTrackCar + epsilon;
}

/**
 * Per-run setup-change markers keyed by run id, computed over a newest-first
 * window. Each run diffs against the next older run **on the same car**; the
 * first run on a car (no baseline) and runs with no setup change get no entry.
 * Tire / battery / additive changes are excluded (see `isExcludedSetupChangeKey`).
 */
export function computeSetupChangesByRunId(
  runsDesc: Array<{ id: string; carId: string | null; setupData: unknown }>
): Map<string, RunSetupChangeIndicator> {
  const byRunId = new Map<string, RunSetupChangeIndicator>();
  for (let i = 0; i < runsDesc.length; i++) {
    const run = runsDesc[i];
    let previous: (typeof runsDesc)[number] | null = null;
    for (let j = i + 1; j < runsDesc.length; j++) {
      if (runsDesc[j].carId === run.carId) {
        previous = runsDesc[j];
        break;
      }
    }
    if (!previous) continue; // first run on this car — no baseline to diff.
    const changedFieldLabels = setupChangedRowsSincePrevious(run.setupData, previous.setupData)
      .filter((row) => !isExcludedSetupChangeKey(row.key))
      .map((row) => row.label);
    if (changedFieldLabels.length > 0) byRunId.set(run.id, { changedFieldLabels });
  }
  return byRunId;
}

/** Distinct car options in first-seen order (chronological input preserved). */
export function collectCarOptions(
  runs: Array<{ carId: string | null; carName: string }>
): AnalysisCarOption[] {
  const seen = new Map<string, AnalysisCarOption>();
  for (const run of runs) {
    const key = run.carId ?? "__none__";
    if (!seen.has(key)) seen.set(key, { carId: run.carId, carName: run.carName });
  }
  return [...seen.values()];
}
