import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import type { BetweenRunHintSignal } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { parseHandlingAssessmentJson } from "@/lib/runHandlingAssessment";

function lapSideRegressed(summary: EngineerRunSummaryV2): boolean {
  const b = summary.lapOutcome.best;
  const a5 = summary.lapOutcome.avgTop5;
  if (!b.notMeaningful && b.flag === "regressed") return true;
  if (!a5.notMeaningful && a5.flag === "regressed") return true;
  return false;
}

function lapSideImproved(summary: EngineerRunSummaryV2): boolean {
  const b = summary.lapOutcome.best;
  const a5 = summary.lapOutcome.avgTop5;
  const bOk = !b.notMeaningful && b.flag === "improved";
  const a5Ok = !a5.notMeaningful && a5.flag === "improved";
  return bOk || a5Ok;
}

function lowLapData(summary: EngineerRunSummaryV2): boolean {
  const cur = summary.lapCountIncluded.current;
  if (cur < 3) return true;
  const best = summary.lapOutcome.best;
  const a5 = summary.lapOutcome.avgTop5;
  return Boolean(
    (best.notMeaningful && a5.notMeaningful) ||
      (best.flag === "unknown" && a5.flag === "unknown")
  );
}

/**
 * Deterministic tags for UI / prompts (not a substitute for KB).
 */
export function computeBetweenRunSignals(
  summary: EngineerRunSummaryV2,
  handlingAssessmentJson: unknown
): BetweenRunHintSignal[] {
  const signals: BetweenRunHintSignal[] = [];
  if (lowLapData(summary)) signals.push("low_lap_data");
  if (summary.setupChanges.length > 0) signals.push("meaningful_setup_change");

  if (lapSideRegressed(summary)) signals.push("lap_regressed");
  else if (lapSideImproved(summary)) signals.push("lap_improved");

  const parsed = parseHandlingAssessmentJson(handlingAssessmentJson);
  const feel = parsed?.feelVsLastRun;
  if (typeof feel === "number") {
    if (feel < 0) signals.push("feel_worse");
    if (feel > 0) signals.push("feel_better");
  }

  return signals;
}
