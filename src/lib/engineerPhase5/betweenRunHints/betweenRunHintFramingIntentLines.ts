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
  if (setupChanges.length > 0) {
    out.push(
      "Deterministic — **pairwise setup rows are already applied on the primary car:** In summary.setupChanges / pairwiseSetupDigest each row is **baseline → primary** (`before` = baseline sheet value, `after` = **current primary setup**). Do **not** tell the user to \"try\" or \"apply\" that same before→after as if it were still undone — the car already reflects `after`. If outcomes worsened, you may suggest **revert toward `before`**, verify, or a **different** lever — never re-prescribe that identical delta as a forward experiment."
    );
  }
  return out;
}
