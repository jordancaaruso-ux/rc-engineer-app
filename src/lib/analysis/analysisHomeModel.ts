import {
  computeConsistencyFromCV,
  computeMistakeLaps,
  getAverageTopN,
  getIncludedLaps,
  primaryLapRowsFromRun,
  roundConsistencyScore,
  analyzeLapRows,
} from "@/lib/lapAnalysis";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { calendarYmdInTimeZone } from "@/lib/formatDate";
import type { RunTireIndicator } from "@/lib/runs/tireSetChange";

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

export type AnalysisTrendRun = {
  id: string;
  carId: string | null;
  carName: string;
  /** Short x-axis label, e.g. "Q1", "A2", "R3". */
  shortLabel: string;
  createdAtIso: string;
  metrics: AnalysisRunMetrics;
  /** Tire set + wear for this run; null when no set was logged. */
  tireIndicator: RunTireIndicator | null;
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
