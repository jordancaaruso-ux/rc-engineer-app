import type { EngineerLapMetricOutcome, EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { fieldRelativityForSummary } from "@/lib/engineerPhase5/fieldRelativityForSummary";

/** UI label for the avg-top-10 block (avoid “sustained pace”). */
export const PACE_MULTI_LAP_SECTION_TITLE = "Avg top 10 (this run)";

export type PaceVsReferencePrimary = {
  metricKey: "avg_top_10" | "avg_top_5" | "best";
  metricLabel: string;
  deltaSeconds: number;
  currentSeconds: number | null;
  referenceLabel: string;
};

export type PaceComparisonHeadline = {
  fieldRel: ReturnType<typeof fieldRelativityForSummary>;
  /** Compared to your engineer reference run (same metric ladder as lap summary). */
  vsReference: PaceVsReferencePrimary | null;
  /** Session field: avg top 10 gap vs arithmetic mean (+ rank line when known). */
  fieldAvg10GapVsMeanSeconds: number | null;
  fieldAvg10Meaningful: boolean;
  fieldAvg10RankLine: string | null;
};

function pickVsReference(summary: EngineerRunSummaryV2): PaceVsReferencePrimary | null {
  if (!summary.referenceRunId || !summary.referenceLabel?.trim()) return null;
  const label = summary.referenceLabel.trim();
  const { lapOutcome } = summary;

  const tryMetric = (
    o: EngineerLapMetricOutcome,
    metricKey: PaceVsReferencePrimary["metricKey"],
    metricLabel: string
  ): PaceVsReferencePrimary | null => {
    if (o.notMeaningful) return null;
    const d = o.delta;
    if (d == null || !Number.isFinite(d)) return null;
    return {
      metricKey,
      metricLabel,
      deltaSeconds: d,
      currentSeconds: o.current,
      referenceLabel: label,
    };
  };

  const a10 = tryMetric(lapOutcome.avgTop10, "avg_top_10", "Avg top 10");
  if (a10) return a10;
  const a5 = tryMetric(lapOutcome.avgTop5, "avg_top_5", "Avg top 5");
  if (a5) return a5;
  const b = lapOutcome.best.delta;
  if (b != null && Number.isFinite(b)) {
    return {
      metricKey: "best",
      metricLabel: "Best lap",
      deltaSeconds: b,
      currentSeconds: lapOutcome.best.current,
      referenceLabel: label,
    };
  }
  return null;
}

/**
 * Headline pace story: **you vs your reference run** first (when available), then session-field context.
 * Used by Pace vs field UI and between-run / LLM summaries.
 */
export function computePaceComparisonHeadline(summary: EngineerRunSummaryV2): PaceComparisonHeadline {
  const fieldRel = fieldRelativityForSummary(summary);
  const vsReference = pickVsReference(summary);
  const fs = summary.importedSessionFieldStats;
  const avg10 = fs?.paceVsFieldMeanAnalysis?.find((m) => m.metric === "avg_top_10");

  const fieldAvg10GapVsMeanSeconds =
    avg10?.gapUserMinusFieldMeanSeconds != null && Number.isFinite(avg10.gapUserMinusFieldMeanSeconds)
      ? avg10.gapUserMinusFieldMeanSeconds
      : null;
  const fieldAvg10Meaningful = Boolean(avg10?.meaningful);
  const fieldAvg10RankLine =
    avg10?.rankInField != null && avg10.fieldEntrantCountForMetric >= 2
      ? `${avg10.rankInField} of ${avg10.fieldEntrantCountForMetric} on avg top 10`
      : fieldRel.rank != null && fieldRel.nDrivers != null && fieldRel.nDrivers >= 2
        ? `${fieldRel.rank} of ${fieldRel.nDrivers} on avg top 10`
        : null;

  return {
    fieldRel,
    vsReference,
    fieldAvg10GapVsMeanSeconds,
    fieldAvg10Meaningful,
    fieldAvg10RankLine,
  };
}

/**
 * When pairwise pace (vs reference run) and session-field gap disagree on the same multi-lap metric,
 * return a short cross-check line for the pace panel. Otherwise null.
 */
export function computePairVsFieldCrossCheckLine(
  summary: EngineerRunSummaryV2,
  headline: PaceComparisonHeadline
): string | null {
  const v = headline.vsReference;
  if (!v) return null;
  if (v.metricKey === "best") return null;

  const fs = summary.importedSessionFieldStats;
  const analysis = fs?.paceVsFieldMeanAnalysis;
  if (!analysis?.length) return null;

  let fieldGap: number | null = null;
  let meaningful = false;

  if (v.metricKey === "avg_top_10") {
    fieldGap = headline.fieldAvg10GapVsMeanSeconds;
    meaningful = headline.fieldAvg10Meaningful;
  } else {
    const row = analysis.find((m) => m.metric === "avg_top_5");
    if (row?.gapUserMinusFieldMeanSeconds != null && Number.isFinite(row.gapUserMinusFieldMeanSeconds)) {
      fieldGap = row.gapUserMinusFieldMeanSeconds;
      meaningful = Boolean(row.meaningful);
    }
  }

  if (!meaningful || fieldGap == null || !Number.isFinite(fieldGap)) return null;

  const delta = v.deltaSeconds;
  if (!Number.isFinite(delta)) return null;

  const eps = 1e-6;
  if (Math.abs(delta) < eps || Math.abs(fieldGap) < eps) return null;

  const ref = v.referenceLabel.trim() || "that run";
  const metric = v.metricLabel.toLowerCase();

  if (delta < 0 && fieldGap > 0) {
    return `Cross-check: faster than ${ref} on ${metric}, but still slower than this session's field average on the same metric — treat the pairwise gain cautiously until the field gap moves.`;
  }
  if (delta > 0 && fieldGap < 0) {
    return `Cross-check: slower than ${ref} on ${metric}, yet quicker than this session's field average on the same metric — the field context may still look fine despite the pairwise slip.`;
  }
  return null;
}
