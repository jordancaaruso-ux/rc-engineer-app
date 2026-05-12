import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import type {
  BetweenRunCoachingMode,
  BetweenRunHintSignal,
  HintSessionBriefV1,
} from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import type { HintBaselineProvenance } from "@/lib/engineerPhase5/betweenRunHints/pickHintContextReferenceRun";

function buildFieldCommentary(summary: EngineerRunSummaryV2): string[] {
  const rows = summary.importedSessionFieldStats?.paceVsFieldMeanAnalysis;
  if (!rows?.length) return [];
  const out: string[] = [];
  for (const m of rows) {
    if (!m.meaningful) continue;
    const gap = m.gapUserMinusFieldMeanSeconds;
    if (gap == null || !Number.isFinite(gap)) continue;
    const side = gap <= 0 ? "ahead of or on the session mean" : "behind the session mean";
    out.push(
      `${m.metric}: ${side} (gap ${gap > 0 ? "+" : ""}${gap.toFixed(3)}s vs mean; rank ${m.rankInField ?? "?"}/${m.fieldEntrantCountForMetric})`
    );
    if (out.length >= 2) break;
  }
  return out;
}

export function buildHintSessionBrief(params: {
  signals: BetweenRunHintSignal[];
  summary: EngineerRunSummaryV2;
  handlingProblems: string | null;
  baselineProvenance: HintBaselineProvenance | null;
}): HintSessionBriefV1 {
  const { signals, summary, handlingProblems, baselineProvenance } = params;
  const intentLines: string[] = [];
  const optionalFieldCommentary = buildFieldCommentary(summary);

  if (baselineProvenance) {
    intentLines.push(
      `Hint baseline: ${baselineProvenance.selectionReason}; age bucket: ${baselineProvenance.baselineAgeBucket}; label: ${baselineProvenance.baselineDisplayLabel}.`
    );
    if (baselineProvenance.baselineAgeBucket === "older" || baselineProvenance.baselineAgeBucket === "this_month") {
      intentLines.push(
        "When the baseline is not from the same week, explicitly acknowledge the time gap in copy and lean on documented setup deltas plus lap/feel signals rather than implying it was the last outing."
      );
    }
    if (
      baselineProvenance.engineerReferenceRunId &&
      baselineProvenance.engineerReferenceRunId !== baselineProvenance.hintReferenceRunId
    ) {
      intentLines.push(
        "Default Engineer pairwise compare on the run may use a different reference than this hint; sourcesNote will say so — do not contradict that."
      );
    }
    if (baselineProvenance.baselineHandlingPreview) {
      intentLines.push(`Baseline handling snapshot: ${baselineProvenance.baselineHandlingPreview}`);
    }
  }

  const hp = handlingProblems?.trim();
  if (hp) intentLines.push(`Driver handling problems (current): ${hp}`);

  let coachingMode: BetweenRunCoachingMode = "mixed";
  if (signals.includes("low_lap_data")) {
    coachingMode = "low_data";
  } else if (optionalFieldCommentary.length > 0 && (signals.includes("lap_improved") || signals.includes("lap_regressed"))) {
    coachingMode = "field_context";
  } else if (
    signals.includes("lap_improved") &&
    (signals.includes("feel_better") || !signals.includes("feel_worse")) &&
    !signals.includes("meaningful_setup_change")
  ) {
    coachingMode = "maintain_or_refine";
  } else if (signals.includes("feel_worse") && !signals.includes("lap_regressed")) {
    coachingMode = "tune_feel";
  } else if (
    signals.includes("meaningful_setup_change") &&
    (signals.includes("lap_regressed") || signals.includes("feel_worse"))
  ) {
    coachingMode = "tune_setup";
  }

  if (coachingMode === "low_data") {
    intentLines.push(
      "Lap aggregates are thin — prioritize tire life / track context, single-change discipline, and what to verify next rather than aggressive setup rewrites."
    );
  } else if (coachingMode === "maintain_or_refine") {
    intentLines.push(
      "Pace or feel moved in a good direction with little setup churn — bias toward consolidation, tire/track hygiene, and small verification steps."
    );
  } else if (coachingMode === "tune_feel") {
    intentLines.push(
      "Feel-led regression — keep setup moves tightly tied to handlingPreview / handling problems and KB excerpts; avoid pace-only rationalizations."
    );
  } else if (coachingMode === "tune_setup") {
    intentLines.push(
      "Setup changes line up with pace or feel pain — cite the largest documented moves, prefer one-change walk-backs or controlled retests."
    );
  } else if (coachingMode === "field_context") {
    intentLines.push(
      "Imported field context is usable — you may tie bullets to vs-field mean rows when they align with lapOutcome flags."
    );
  }

  intentLines.push(
    "Why-first copy (required): headline and every bullet must make the reasoning obvious — cite at least one concrete pairwise change from pairwiseSetupDigest / setupChanges (exact before→after) and tie it to what lapOutcome / signals / handlingPreview actually show (e.g. slower vs baseline, flat, not meaningful, feel worse). No detached tuning ideas; the reader must see why each step is relevant."
  );

  return { coachingMode, intentLines, optionalFieldCommentary };
}
