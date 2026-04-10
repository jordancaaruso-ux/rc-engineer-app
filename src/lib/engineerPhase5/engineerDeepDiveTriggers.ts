import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { getEffectiveRunNotes } from "@/lib/engineerPhase5/mergeRunNotes";

const HANDLING_HINTS =
  /\b(understeer|oversteer|push|loose|snap|on.?rail|grip|traction|steering|brake|corner|handling|issue|problem|worse|bad)\b/i;

/**
 * Offer Deep Dive when optional structured follow-up is likely useful (not on every run).
 */
export function shouldOfferEngineerDeepDive(
  summary: EngineerRunSummaryV2,
  run: { notes?: string | null; driverNotes?: string | null; handlingProblems?: string | null }
): boolean {
  if (!summary.referenceRunId) return false;

  const notes = getEffectiveRunNotes(run);
  if (notes && HANDLING_HINTS.test(notes)) return true;
  if (run.handlingProblems?.trim()) return true;

  const best = summary.lapOutcome.best;
  const a5 = summary.lapOutcome.avgTop5;
  if (best.flag === "improved" && a5.flag === "regressed") return true;

  const cons = summary.lapOutcome.consistencyScore;
  if (cons.delta != null && cons.delta < -10) return true;

  return false;
}
