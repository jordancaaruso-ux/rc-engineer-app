import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

function finiteGap(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

function fmtDeltaSec(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(3)}s`;
}

/**
 * Multi-line summary for LLM / compact copy: **avg top 10 vs session field mean** first,
 * optional median avg-top-10 benchmark, then other metrics vs field mean; lap-set fallback uses pole gap + rank.
 */
export function paceVsFieldSummaryFromEngineerSummary(summary: EngineerRunSummaryV2): string | null {
  const fs = summary.importedSessionFieldStats;
  const ranked = summary.fieldImportSession?.ranked ?? [];
  const youRow = ranked.find((r) => r.isPrimaryUser) ?? null;

  if (fs && fs.driverCount >= 2 && fs.paceVsFieldMeanAnalysis && fs.paceVsFieldMeanAnalysis.length > 0) {
    const lines: string[] = [
      `Imported timing: ${fs.driverCount} drivers. Primary sustained pace = avg top 10 vs **session field average** (positive ⇒ slower than that average).`,
    ];
    const avg10 = fs.paceVsFieldMeanAnalysis.find((m) => m.metric === "avg_top_10");
    if (avg10) {
      const rank =
        avg10.rankInField != null && avg10.fieldEntrantCountForMetric >= 2
          ? `rank ${avg10.rankInField}/${avg10.fieldEntrantCountForMetric}`
          : "rank n/a";
      const gap = fmtDeltaSec(avg10.gapUserMinusFieldMeanSeconds);
      const mean =
        avg10.fieldMeanSeconds != null && Number.isFinite(avg10.fieldMeanSeconds)
          ? avg10.fieldMeanSeconds.toFixed(3)
          : "—";
      const you =
        avg10.userSeconds != null && Number.isFinite(avg10.userSeconds) ? avg10.userSeconds.toFixed(3) : "—";
      const tag = avg10.meaningful ? "" : " (need ≥10 laps on your row for full avg top 10)";
      lines.push(`Avg top 10: you ${you}s vs field avg ${mean}s (${gap} vs avg; ${rank})${tag}`);
    }
    const my = fs.matchedYou;
    if (
      my?.avgTop10Seconds != null &&
      fs.fieldMedianAvgTop10Seconds != null &&
      Number.isFinite(fs.fieldMedianAvgTop10Seconds)
    ) {
      const gapMed = my.avgTop10Seconds - fs.fieldMedianAvgTop10Seconds;
      lines.push(
        `Median benchmark: ${fmtDeltaSec(gapMed)} (your avg top 10 minus field median avg top 10)`
      );
    }
    for (const row of fs.paceVsFieldMeanAnalysis) {
      if (row.metric === "avg_top_10") continue;
      const rank =
        row.rankInField != null && row.fieldEntrantCountForMetric >= 2
          ? `rank ${row.rankInField}/${row.fieldEntrantCountForMetric}`
          : "rank n/a";
      const gap = fmtDeltaSec(row.gapUserMinusFieldMeanSeconds);
      const mean = row.fieldMeanSeconds != null && Number.isFinite(row.fieldMeanSeconds) ? row.fieldMeanSeconds.toFixed(3) : "—";
      const you = row.userSeconds != null && Number.isFinite(row.userSeconds) ? row.userSeconds.toFixed(3) : "—";
      const tag = row.meaningful ? "" : " (low lap count for this metric — indicative only)";
      lines.push(`${row.label}: you ${you}s vs field avg ${mean}s (${gap} vs avg; ${rank})${tag}`);
    }
    return lines.join("\n");
  }

  const multiFromStats = fs != null && fs.driverCount >= 2;
  const multiFromSets = ranked.length >= 2;
  const multiDriverField = multiFromStats || multiFromSets;

  if (!multiDriverField) return null;

  const my = fs?.matchedYou;
  const gapBest = finiteGap(my?.gapBestToSessionBestSeconds ?? youRow?.gapToSessionBestSeconds);
  const rank = my?.rankByBest ?? youRow?.rank ?? null;
  const nDrivers =
    multiFromStats && fs ? fs.driverCount : ranked.length >= 2 ? ranked.length : null;

  const parts: string[] = [];
  if (rank != null && nDrivers != null && nDrivers >= 2) {
    parts.push(`${rank} of ${nDrivers} by best lap (lap-set only — link timing session for field-average sustained pace)`);
  }
  if (gapBest != null) {
    const sign = gapBest >= 0 ? "+" : "";
    parts.push(`${sign}${gapBest.toFixed(3)}s vs session best lap`);
  }
  if (parts.length === 0) return "Multi-driver session (gaps not matched)";
  return parts.join(" · ");
}
