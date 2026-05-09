import type { EngineerRunSummaryV2, PaceVsFieldMetricId } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

function finiteGap(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

function gapFromPaceVsFieldMean(summary: EngineerRunSummaryV2, metric: PaceVsFieldMetricId): number | null {
  const rows = summary.importedSessionFieldStats?.paceVsFieldMeanAnalysis;
  const row = rows?.find((m) => m.metric === metric);
  return finiteGap(row?.gapUserMinusFieldMeanSeconds);
}

export type FieldRelativityForSummary = {
  multiDriverField: boolean;
  showVsFieldColumn: boolean;
  vsFieldUsesSessionMeans: boolean;
  gapBest: number | null;
  gapAvg5: number | null;
  gapAvg10: number | null;
  gapAvg15: number | null;
  rank: number | null;
  nDrivers: number | null;
};

/**
 * Multi-driver imported timing: **Vs field** prefers session **field mean** per metric when aggregates exist
 * (positive ⇒ slower than session average). Falls back to gaps vs session-best competitor when only lap-set rows exist.
 */
export function fieldRelativityForSummary(summary: EngineerRunSummaryV2): FieldRelativityForSummary {
  const fs = summary.importedSessionFieldStats;
  const ranked = summary.fieldImportSession?.ranked ?? [];
  const youRow = ranked.find((r) => r.isPrimaryUser) ?? null;
  const multiFromStats = fs != null && fs.driverCount >= 2;
  const multiFromSets = ranked.length >= 2;
  const multiDriverField = multiFromStats || multiFromSets;

  if (!multiDriverField) {
    return {
      multiDriverField: false,
      showVsFieldColumn: false,
      vsFieldUsesSessionMeans: false,
      gapBest: null,
      gapAvg5: null,
      gapAvg10: null,
      gapAvg15: null,
      rank: null,
      nDrivers: null,
    };
  }

  const meanRows = fs?.paceVsFieldMeanAnalysis;
  const useMeans = Boolean(meanRows?.length);
  const my = fs?.matchedYou;

  let gapBest: number | null = null;
  let gapAvg5: number | null = null;
  let gapAvg10: number | null = null;
  let gapAvg15: number | null = null;

  if (useMeans) {
    gapBest = gapFromPaceVsFieldMean(summary, "best");
    gapAvg5 = gapFromPaceVsFieldMean(summary, "avg_top_5");
    gapAvg10 = gapFromPaceVsFieldMean(summary, "avg_top_10");
    gapAvg15 = gapFromPaceVsFieldMean(summary, "avg_top_15");
  } else {
    gapBest = finiteGap(my?.gapBestToSessionBestSeconds ?? youRow?.gapToSessionBestSeconds);
    gapAvg5 = finiteGap(my?.gapAvgTop5ToSessionBestAvg5Seconds);
    gapAvg10 = finiteGap(my?.gapAvgTop10ToSessionBestAvg10Seconds);
    gapAvg15 = null;
  }

  const avg10RankRow = meanRows?.find((m) => m.metric === "avg_top_10");
  const rank =
    avg10RankRow?.rankInField != null && avg10RankRow.fieldEntrantCountForMetric >= 2
      ? avg10RankRow.rankInField
      : my?.rankByBest ?? youRow?.rank ?? null;
  const nDrivers =
    avg10RankRow?.fieldEntrantCountForMetric != null && avg10RankRow.fieldEntrantCountForMetric >= 2
      ? avg10RankRow.fieldEntrantCountForMetric
      : fs && fs.driverCount >= 2
        ? fs.driverCount
        : ranked.length >= 2
          ? ranked.length
          : null;

  const hasActionableGap = gapBest != null || gapAvg5 != null || gapAvg10 != null || gapAvg15 != null;

  return {
    multiDriverField: true,
    showVsFieldColumn: hasActionableGap,
    vsFieldUsesSessionMeans: useMeans,
    gapBest,
    gapAvg5,
    gapAvg10,
    gapAvg15,
    rank,
    nDrivers,
  };
}
