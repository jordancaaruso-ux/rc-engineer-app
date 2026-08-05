import "server-only";

import type { ParameterIntentMatch } from "@/lib/engineerPhase5/parameterEffects/types";
import { mechanismsForKey, type SetupMechanismId } from "@/lib/engineerPhase5/setupMechanismMap";
import type {
  EvidenceCertainty,
  GradedLeverV1,
  OverallRecommendationGrade,
  ProblemStatementV1,
} from "@/lib/engineerPhase5/reasoningSpine/types";

const STRENGTH_RANK = { strong: 3, moderate: 2, weak: 1 } as const;
const CERTAINTY_RANK = { high: 4, moderate: 3, low: 2, very_low: 1 } as const;

function primaryMechanismForKey(key: string): SetupMechanismId | null {
  const mappings = mechanismsForKey(key);
  return mappings[0]?.mechanism ?? null;
}

function gradeEvidenceCertainty(input: {
  match: ParameterIntentMatch;
  problem: ProblemStatementV1;
}): EvidenceCertainty {
  const { match, problem } = input;
  let score = 0;
  if (match.effect.strength === "strong") score += 2;
  else if (match.effect.strength === "moderate") score += 1;
  if (!match.effect.hedge) score += 1;
  if (match.communityMedian != null) score += 1;
  if (!match.hedgedDirectionAtPosition) score += 1;
  if (problem.confounders.length >= 2) score -= 1;
  if (problem.recommendationMode === "diagnose") score -= 2;

  // Bands dropped by 2 alongside the removal of the `diagnosisConfidence` term, which used
  // to contribute up to +2 here. Without the shift every lever would grade one tier lower
  // than it did, which would be a silent behaviour change rather than a deliberate one.
  if (score >= 3) return "high";
  if (score >= 2) return "moderate";
  if (score >= 1) return "low";
  return "very_low";
}

function overallGrade(
  effectStrength: GradedLeverV1["effectStrength"],
  effectHedged: boolean,
  certainty: EvidenceCertainty,
  hedgedAtPosition: boolean
): OverallRecommendationGrade {
  if (hedgedAtPosition || certainty === "very_low") return "weak";
  if (
    effectStrength === "strong" &&
    !effectHedged &&
    (certainty === "high" || certainty === "moderate")
  ) {
    return "strong";
  }
  if (effectStrength === "weak" && certainty === "low") return "weak";
  return "conditional";
}

function buildCaveats(match: ParameterIntentMatch, certainty: EvidenceCertainty): string[] {
  const caveats: string[] = [];
  if (match.effect.hedge) caveats.push("KB hedges this effect — outcome may vary with balance.");
  if (match.hedgedDirectionAtPosition) {
    caveats.push("Already at/past the typical extreme for this move direction.");
  }
  if (match.communityMedian == null) {
    caveats.push("No community median on file for this parameter.");
  }
  if (certainty === "very_low" || certainty === "low") {
    caveats.push("Thin evidence — treat as a test move, not a confident prescription.");
  }
  if (match.effect.notes) caveats.push(match.effect.notes);
  return caveats;
}

function gradeSingleLever(
  match: ParameterIntentMatch,
  problem: ProblemStatementV1
): GradedLeverV1 {
  const mechanismId = primaryMechanismForKey(match.parameterKey);
  const evidenceCertainty = gradeEvidenceCertainty({ match, problem });
  return {
    parameterKey: match.parameterKey,
    mechanismId,
    recommendedMoveDirection: match.recommendedMoveDirection,
    kbSource: match.kbSource,
    kbSection: match.kbSection,
    effectStrength: match.effect.strength,
    effectHedged: match.effect.hedge,
    evidenceCertainty,
    overallGrade: overallGrade(
      match.effect.strength,
      match.effect.hedge,
      evidenceCertainty,
      match.hedgedDirectionAtPosition
    ),
    userCurrent: match.userCurrent,
    communityMedian: match.communityMedian,
    positionBand: match.positionBand,
    hedgedDirectionAtPosition: match.hedgedDirectionAtPosition,
    caveats: buildCaveats(match, evidenceCertainty),
  };
}

/**
 * Grade catalog matches, filter by axle/end, and dedupe by primary mechanism.
 */
export function buildGradedLevers(input: {
  matches: readonly ParameterIntentMatch[];
  problem: ProblemStatementV1;
}): GradedLeverV1[] {
  /**
   * The axle filter was removed 2026-08-04 along with keyword intent matching. It dropped
   * any lever whose key did not match `problem.end` — but `end` is now derived purely from
   * the phase ratings, so it describes WHERE THE CAR IS SHORT, not what the driver asked
   * about. Those are different things: a driver whose ratings read understeer can still be
   * asking how to free the rear, and the filter silently discarded every rear lever for him.
   *
   * Deciding whether a rear lever answers a front complaint is judgement, and it belongs
   * with the model reading both the ratings and the driver's own words.
   */
  const graded = input.matches.map((m) => gradeSingleLever(m, input.problem));

  const byMechanism = new Map<string, GradedLeverV1>();
  for (const lever of graded) {
    const key = lever.mechanismId ?? lever.parameterKey;
    const existing = byMechanism.get(key);
    if (!existing) {
      byMechanism.set(key, lever);
      continue;
    }
    const better =
      STRENGTH_RANK[lever.effectStrength] > STRENGTH_RANK[existing.effectStrength] ||
      (lever.effectStrength === existing.effectStrength &&
        CERTAINTY_RANK[lever.evidenceCertainty] > CERTAINTY_RANK[existing.evidenceCertainty]);
    if (better) byMechanism.set(key, lever);
  }

  return [...byMechanism.values()].sort((a, b) => {
    const gradeOrder = { strong: 3, conditional: 2, weak: 1 };
    const gd = gradeOrder[b.overallGrade] - gradeOrder[a.overallGrade];
    if (gd !== 0) return gd;
    return STRENGTH_RANK[b.effectStrength] - STRENGTH_RANK[a.effectStrength];
  });
}
