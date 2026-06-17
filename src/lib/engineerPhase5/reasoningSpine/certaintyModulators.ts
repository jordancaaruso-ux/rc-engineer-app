import "server-only";

import type { SetupOutcomeMemoryV1 } from "@/lib/engineerPhase5/setupOutcomeMemory";
import type { GradedLeverV1, EvidenceCertainty } from "@/lib/engineerPhase5/reasoningSpine/types";

const CERTAINTY_RANK: Record<EvidenceCertainty, number> = {
  high: 4,
  moderate: 3,
  low: 2,
  very_low: 1,
};

const RANK_CERTAINTY: EvidenceCertainty[] = ["very_low", "low", "moderate", "high"];

function downgrade(c: EvidenceCertainty): EvidenceCertainty {
  const i = CERTAINTY_RANK[c];
  return RANK_CERTAINTY[Math.max(0, i - 2)] ?? "very_low";
}

/**
 * Personal history modulates evidence certainty only — never reorders levers.
 */
export function applyPersonalCertaintyModulators(
  levers: GradedLeverV1[],
  memory: SetupOutcomeMemoryV1 | null | undefined
): GradedLeverV1[] {
  if (!memory?.rows.length || levers.length === 0) return levers;

  return levers.map((lever) => {
    const dirWord = lever.recommendedMoveDirection === "up" ? "raised" : "lowered";
    const conflict = memory.rows.find(
      (r) =>
        r.key === lever.parameterKey &&
        r.outcome === "negative" &&
        r.priorChange.toLowerCase().includes(dirWord)
    );
    if (!conflict) return lever;

    const caveats = [
      ...lever.caveats,
      `Personal history: you marked ${lever.parameterKey} ${conflict.priorChange} worse on a prior run (${conflict.evidence[0] ?? "post-run chip"}).`,
    ];
    const evidenceCertainty = downgrade(lever.evidenceCertainty);
    const overallGrade =
      evidenceCertainty === "very_low" || lever.hedgedDirectionAtPosition
        ? "weak"
        : lever.overallGrade === "strong" && evidenceCertainty === "high"
          ? "strong"
          : "conditional";

    return { ...lever, caveats, evidenceCertainty, overallGrade };
  });
}
