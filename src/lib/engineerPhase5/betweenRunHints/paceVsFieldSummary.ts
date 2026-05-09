import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

function finiteGap(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/**
 * One-line pace vs imported field for between-run hints (mirrors Engineer summary semantics).
 */
export function paceVsFieldSummaryFromEngineerSummary(summary: EngineerRunSummaryV2): string | null {
  const fs = summary.importedSessionFieldStats;
  const ranked = summary.fieldImportSession?.ranked ?? [];
  const youRow = ranked.find((r) => r.isPrimaryUser) ?? null;
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
    parts.push(`${sign}${gapBest.toFixed(3)}s vs session best`);
  }
  if (parts.length === 0) return "Multi-driver session (gaps not matched)";
  return parts.join(" · ");
}
