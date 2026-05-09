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
 * Multi-line summary for LLM / compact copy: you vs **session field mean** when aggregates exist,
 * else fall back to rank + gap vs session best from lap-set rows.
 */
export function paceVsFieldSummaryFromEngineerSummary(summary: EngineerRunSummaryV2): string | null {
  const fs = summary.importedSessionFieldStats;
  const ranked = summary.fieldImportSession?.ranked ?? [];
  const youRow = ranked.find((r) => r.isPrimaryUser) ?? null;

  if (fs && fs.driverCount >= 2 && fs.paceVsFieldMeanAnalysis && fs.paceVsFieldMeanAnalysis.length > 0) {
    const lines: string[] = [
      `Imported timing: ${fs.driverCount} drivers; gaps vs **session field average** (positive ⇒ slower than that average).`,
    ];
    for (const row of fs.paceVsFieldMeanAnalysis) {
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
    parts.push(`${rank} of ${nDrivers} by best lap`);
  }
  if (gapBest != null) {
    const sign = gapBest >= 0 ? "+" : "";
    parts.push(`${sign}${gapBest.toFixed(3)}s vs session best lap`);
  }
  if (parts.length === 0) return "Multi-driver session (gaps not matched)";
  return parts.join(" · ");
}
