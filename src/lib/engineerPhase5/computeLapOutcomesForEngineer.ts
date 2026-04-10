import {
  getAverageTopN,
  getIncludedLapDashboardMetrics,
  getIncludedLaps,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import type {
  EngineerLapMetricFlag,
  EngineerLapMetricOutcome,
  EngineerRunSummaryV2,
} from "@/lib/engineerPhase5/engineerRunSummaryTypes";

export const ENGINEER_LAP_EPS_SEC = 0.03;
export const ENGINEER_CONSISTENCY_SCORE_EPS = 2;

function classifyTimeDelta(delta: number | null, notMeaningful: boolean): EngineerLapMetricFlag {
  if (notMeaningful) return "unknown";
  if (delta == null || !Number.isFinite(delta)) return "unknown";
  if (Math.abs(delta) < ENGINEER_LAP_EPS_SEC) return "flat";
  return delta < 0 ? "improved" : "regressed";
}

function classifyConsistencyDelta(delta: number | null, notMeaningful: boolean): EngineerLapMetricFlag {
  if (notMeaningful) return "unknown";
  if (delta == null || !Number.isFinite(delta)) return "unknown";
  if (Math.abs(delta) < ENGINEER_CONSISTENCY_SCORE_EPS) return "flat";
  return delta > 0 ? "improved" : "regressed";
}

function metricRow(
  current: number | null,
  reference: number | null,
  needMinLaps: number,
  currentLapCount: number,
  refLapCount: number | null,
  kind: "time" | "consistency"
): EngineerLapMetricOutcome {
  const notMeaningful =
    currentLapCount < needMinLaps || (refLapCount != null && refLapCount < needMinLaps);
  const delta =
    current != null && reference != null && Number.isFinite(current) && Number.isFinite(reference)
      ? current - reference
      : null;
  const flag =
    kind === "time"
      ? classifyTimeDelta(delta, notMeaningful)
      : classifyConsistencyDelta(delta, notMeaningful);
  return { current, reference, delta, flag, notMeaningful };
}

export type LapOutcomeBundle = EngineerRunSummaryV2["lapOutcome"];

export function computeLapOutcomesForEngineer(
  currentRun: { lapTimes: unknown; lapSession?: unknown },
  referenceRun: { lapTimes: unknown; lapSession?: unknown } | null
): {
  lapOutcome: LapOutcomeBundle;
  lapCountIncluded: { current: number; reference: number | null };
} {
  const curRows = primaryLapRowsFromRun(currentRun);
  const refRows = referenceRun ? primaryLapRowsFromRun(referenceRun) : null;

  const curInc = getIncludedLaps(curRows);
  const refInc = refRows ? getIncludedLaps(refRows) : null;
  const curN = curInc.length;
  const refN = refInc?.length ?? null;

  const curDash = getIncludedLapDashboardMetrics(curRows);
  const refDash = refRows != null ? getIncludedLapDashboardMetrics(refRows) : null;

  const bestCur = curDash.bestLap;
  const bestRef = refDash?.bestLap ?? null;

  const lapOutcome: LapOutcomeBundle = {
    best: metricRow(bestCur, bestRef, 1, curN, refN, "time"),
    avgTop5: metricRow(
      curDash.avgTop5,
      refDash?.avgTop5 ?? null,
      5,
      curN,
      refN,
      "time"
    ),
    avgTop10: metricRow(
      curDash.avgTop10,
      refDash?.avgTop10 ?? null,
      10,
      curN,
      refN,
      "time"
    ),
    avgTop15: metricRow(
      getAverageTopN(curRows, 15),
      refRows != null ? getAverageTopN(refRows, 15) : null,
      15,
      curN,
      refN,
      "time"
    ),
    consistencyScore: metricRow(
      curDash.consistencyScore,
      refDash?.consistencyScore ?? null,
      2,
      curN,
      refN,
      "consistency"
    ),
  };

  return {
    lapOutcome,
    lapCountIncluded: { current: curN, reference: refN },
  };
}
