import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

const MAX_LEN = 520;

/**
 * Single canonical line of documented pairwise tuning moves for between-run hint LLM context.
 */
export function buildPairwiseSetupDigestForHints(summary: EngineerRunSummaryV2): string | null {
  const rows = summary.setupChanges;
  if (!rows.length) return null;
  const parts = rows.map((c) => `${c.label}: ${c.before} → ${c.after}`);
  const s = `Documented pairwise tuning changes (${rows.length}): ${parts.join("; ")}`;
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s;
}
