import type { ImportedSessionFieldStatsEngineerCompactV1 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

export const RUN_PACING_OPERATIONAL_WEAR_NOTE =
  "tireRunNumber plus optional TireSet.initialRunCount is an operational index from logging (baseline runs on the compound), not physical rubber chemistry or heat cycles.";

export type FieldPaceAvgTop10SnapshotV1 = {
  gapUserMinusFieldMeanSeconds: number | null;
  rankInField: number | null;
  meaningful: boolean;
  fieldMeanSeconds: number | null;
  userSeconds: number | null;
  fieldEntrantCountForMetric: number;
};

export type RunPacingContextV1 = {
  version: 1;
  tireWear: null | {
    tireSetId: string;
    tireSetLabel: string | null;
    tireRunNumber: number;
    effectiveWearIndex: number;
    operationalWearNote: string;
  };
  /** Session competition pace headline: avg top 10 vs session field mean when timing aggregates exist. */
  fieldPaceAvgTop10: FieldPaceAvgTop10SnapshotV1 | null;
};

export function buildRunPacingContextV1(input: {
  tireSetId: string | null;
  tireSetLabel: string | null;
  initialRunCount?: number | null;
  tireRunNumber: number;
  importedSessionFieldStats: ImportedSessionFieldStatsEngineerCompactV1 | null;
}): RunPacingContextV1 {
  const initial = input.initialRunCount ?? 0;
  const tid = input.tireSetId?.trim();
  const tireWear =
    tid != null && tid.length > 0
      ? {
          tireSetId: tid,
          tireSetLabel: input.tireSetLabel,
          tireRunNumber: input.tireRunNumber,
          effectiveWearIndex: input.tireRunNumber + initial,
          operationalWearNote: RUN_PACING_OPERATIONAL_WEAR_NOTE,
        }
      : null;

  const row =
    input.importedSessionFieldStats?.paceVsFieldMeanAnalysis?.find(
      (m) => m.metric === "avg_top_10"
    ) ?? null;

  const fieldPaceAvgTop10 =
    row != null
      ? {
          gapUserMinusFieldMeanSeconds: row.gapUserMinusFieldMeanSeconds,
          rankInField: row.rankInField,
          meaningful: row.meaningful,
          fieldMeanSeconds: row.fieldMeanSeconds,
          userSeconds: row.userSeconds,
          fieldEntrantCountForMetric: row.fieldEntrantCountForMetric,
        }
      : null;

  return { version: 1, tireWear, fieldPaceAvgTop10 };
}
