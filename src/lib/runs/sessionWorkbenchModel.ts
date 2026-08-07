import {
  computeAnalysisRunMetrics,
  computeLapDistribution,
  computeSetupChangesByRunId,
  shortRunLabel,
  type AnalysisTrendModel,
  type AnalysisTrendRun,
} from "@/lib/analysis/analysisHomeModel";
import { computeTireIndicatorsByRunId } from "@/lib/runs/tireSetChange";

/**
 * Shaping for the desktop Sessions workbench (`SessionsWorkbench`).
 *
 * The phone reads Sessions as a list you tap into; a 1440px screen can hold the
 * list AND what it points at, so at lg+ the same rows drive a reading pane that
 * shows either the whole day's trend or one run. This file builds the day-level
 * half — one `AnalysisTrendModel` per session group, exactly the shape
 * `SessionTrendCard` already renders on /analysis, so the two can never drift.
 *
 * Prisma-free on purpose (mirrors `analysisHomeModel`) — it takes rows the page
 * has already fetched rather than querying again.
 */

/** Minimum runs with laps before a group's trend chart says anything. */
export const WORKBENCH_TREND_MIN_RUNS = 1;

export type WorkbenchRunSource = {
  id: string;
  carId: string | null;
  carNameSnapshot?: string | null;
  car?: { name: string } | null;
  createdAt: Date | string;
  lapTimes: unknown;
  lapSession?: unknown;
  bestLapSeconds?: number | null;
  avgTop5LapSeconds?: number | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  tireStintId?: string | null;
  tireRunNumber?: number | null;
  tireAgeKnown?: boolean | null;
  tireType?: { id: string; displayName: string } | null;
};

/**
 * The slice of a `RunHistoryGroup` this file reads. Structural rather than the
 * full group type so the page can pass its Prisma rows straight in — the group
 * carries plenty of fields (sortAt, eventId, …) that shaping never touches.
 */
export type WorkbenchGroupSource = {
  title: string;
  type: "Testing" | "Race Meeting";
  /** Newest-first — tire and setup indicators are both "vs the previous run". */
  runs: WorkbenchRunSource[];
};

function carNameOf(run: WorkbenchRunSource): string {
  return run.car?.name ?? run.carNameSnapshot ?? "Unknown car";
}

/**
 * One group's runs as a trend model. `runsDescending` must be the group's runs
 * newest-first — the same order the page already has them in — because the tire
 * and setup-change indicators are both "vs the previous run on this car".
 *
 * `setupDataByRunId` is optional: without it the wrench row is simply absent,
 * which is the honest rendering when the page hasn't loaded setup snapshots.
 */
export function buildGroupTrendModel(
  group: WorkbenchGroupSource,
  opts?: { setupDataByRunId?: Map<string, unknown> }
): AnalysisTrendModel | null {
  const runsDescending = group.runs;
  if (runsDescending.length === 0) return null;

  const tireByRunId = computeTireIndicatorsByRunId(
    runsDescending.map((run) => ({
      id: run.id,
      carId: run.carId,
      tireStintId: run.tireStintId ?? null,
      tireRunNumber: run.tireRunNumber ?? null,
      tireAgeKnown: run.tireAgeKnown ?? null,
      tireType: run.tireType ?? null,
    }))
  );

  const setupByRunId = opts?.setupDataByRunId
    ? computeSetupChangesByRunId(
        runsDescending.map((run) => ({
          id: run.id,
          carId: run.carId,
          setupData: opts.setupDataByRunId!.get(run.id) ?? null,
        }))
      )
    : null;

  // Chronological for the chart's x-axis; fallback R{n} labels count per car so
  // switching cars still reads R1..Rn.
  const chronological = [...runsDescending].reverse();
  const perCarIndex = new Map<string, number>();
  const trendRuns: AnalysisTrendRun[] = [];

  for (const run of chronological) {
    const metrics = computeAnalysisRunMetrics(run);
    if (metrics.best == null) continue; // no laps, no point on the chart
    const carKey = run.carId ?? "__none__";
    const index = perCarIndex.get(carKey) ?? 0;
    perCarIndex.set(carKey, index + 1);
    trendRuns.push({
      id: run.id,
      carId: run.carId,
      carName: carNameOf(run),
      shortLabel: shortRunLabel(run, index),
      createdAtIso: new Date(run.createdAt).toISOString(),
      metrics,
      distribution: computeLapDistribution(run),
      tireIndicator: tireByRunId.get(run.id) ?? null,
      setupChange: setupByRunId?.get(run.id) ?? null,
    });
  }

  if (trendRuns.length < WORKBENCH_TREND_MIN_RUNS) return null;

  const carOptions: Array<{ carId: string | null; carName: string }> = [];
  const seenCars = new Set<string>();
  for (const run of trendRuns) {
    const key = run.carId ?? "__none__";
    if (seenCars.has(key)) continue;
    seenCars.add(key);
    carOptions.push({ carId: run.carId, carName: run.carName });
  }

  return {
    scopeKind: group.type === "Race Meeting" ? "event" : "day",
    scopeLabel: group.title,
    runs: trendRuns,
    carOptions,
    defaultCarId: carOptions[0]?.carId ?? null,
  };
}

/** Compact per-run figures for the left rail's nested run rows. */
export type WorkbenchRunRow = {
  id: string;
  /** "Q2", "A1", "Run 3" — the same short label the chart's x-axis uses. */
  label: string;
  carName: string;
  best: number | null;
  median: number | null;
  lapCount: number;
  /** This run holds the group's fastest lap. */
  isGroupBest: boolean;
};

/** Rows for one group, newest-first — the order the rail lists them in. */
export function buildGroupRunRows(group: WorkbenchGroupSource): WorkbenchRunRow[] {
  const chronological = [...group.runs].reverse();
  const perCarIndex = new Map<string, number>();
  const labelByRunId = new Map<string, string>();
  for (const run of chronological) {
    const carKey = run.carId ?? "__none__";
    const index = perCarIndex.get(carKey) ?? 0;
    perCarIndex.set(carKey, index + 1);
    labelByRunId.set(run.id, shortRunLabel(run, index));
  }

  const rows = group.runs.map((run) => {
    const metrics = computeAnalysisRunMetrics(run);
    return {
      id: run.id,
      label: labelByRunId.get(run.id) ?? "Run",
      carName: carNameOf(run),
      best: metrics.best,
      median: metrics.median,
      lapCount: metrics.cleanLapCount,
      isGroupBest: false,
    };
  });

  const bests = rows.map((r) => r.best).filter((b): b is number => b != null);
  if (bests.length > 0) {
    const fastest = Math.min(...bests);
    for (const row of rows) row.isGroupBest = row.best === fastest;
  }
  return rows;
}

export type WorkbenchGroup = {
  id: string;
  title: string;
  type: "Testing" | "Race Meeting";
  trackName: string | null;
  dateLabel: string;
  runs: WorkbenchRunRow[];
  trend: AnalysisTrendModel | null;
};
