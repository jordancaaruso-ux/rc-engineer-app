import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

/**
 * Deterministic copy for the between-run hints LLM: how to read balance chips and pairwise setup rows.
 */
export function buildBetweenRunHintFramingIntentLines(
  setupChanges: EngineerRunSummaryV2["setupChanges"]
): string[] {
  const out: string[] = [];
  out.push(
    "Deterministic — corner **balance** chips (−3 push … +3 oversteer per phase): **0 is neutral / most balanced** for that phase. Larger **|score|** means a **stronger bias** (more push if negative, more oversteer if positive). Moving a phase **toward 0** reads as **more balanced**; moving **away from 0** reads as **less balanced**. Use handlingPreview corner balance lines with that convention."
  );
  out.push(
    "Deterministic — **session notes are run-local:** `recentSessions[].notesPreview` and pattern-digest `notes` belong **only** to that run. When you quote or paraphrase them, name the run (`displayLabel` and/or `runId`). Do **not** generalize one card's wording into \"chronic …\", \"always …\", or \"in previous runs …\" unless **multiple** runs' `notesPreview` in the JSON actually show the same theme. Do **not** use another strip card's notes to explain **pairwise** `summary.setupChanges` / `pairwiseSetupDigest` rows unless that card's `runId` equals **summary.referenceRunId** (pairwise hint baseline) when non-null, or you are explicitly discussing **that** card's chrono story (not the baseline pair)."
  );
  out.push(
    "Deterministic — **pairwise (hint baseline) setup→outcome:** Bullets that explain moves in `summary.setupChanges` / `pairwiseSetupDigest` must ground chip/lap/feel in **primary vs hint-baseline** evidence: `lapOutcome`, primary `handlingPreview`, and any **Baseline handling snapshot** line above — not in free-text notes from a different outing. `recentSessions[0].setupChangesFromPrevious` is **chrono vs the next older strip card** and may differ from the hint baseline; do not conflate the two in the same sentence without saying which comparison you mean."
  );
  if (setupChanges.length > 0) {
    out.push(
      "Deterministic — **pairwise setup rows are already applied on the primary car:** In summary.setupChanges / pairwiseSetupDigest each row is **baseline → primary** (`before` = baseline sheet value, `after` = **current primary setup**). Do **not** tell the user to \"try\" or \"apply\" that same before→after as if it were still undone — the car already reflects `after`. If outcomes worsened, you may suggest **revert toward `before`**, verify, or a **different** lever — never re-prescribe that identical delta as a forward experiment."
    );
  }
  return out;
}
