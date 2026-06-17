import "server-only";

import type { ParameterIntentMatch } from "@/lib/engineerPhase5/parameterEffects/types";
import { mechanismsForKey, type SetupMechanismId } from "@/lib/engineerPhase5/setupMechanismMap";
import type {
  EvidenceCertainty,
  GradedLeverV1,
  OverallRecommendationGrade,
  ProblemEnd,
  ProblemStatementV1,
} from "@/lib/engineerPhase5/reasoningSpine/types";

const STRENGTH_RANK = { strong: 3, moderate: 2, weak: 1 } as const;
const CERTAINTY_RANK = { high: 4, moderate: 3, low: 2, very_low: 1 } as const;

function primaryMechanismForKey(key: string): SetupMechanismId | null {
  const mappings = mechanismsForKey(key);
  return mappings[0]?.mechanism ?? null;
}

function matchesEndFilter(
  parameterKey: string,
  mechanismId: SetupMechanismId | null,
  end: ProblemEnd
): boolean {
  if (end === "unknown" || end === "both") return true;
  const lower = parameterKey.toLowerCase();
  if (end === "front") {
    return (
      lower.includes("front") ||
      lower.includes("_ff") ||
      lower.includes("_fr") ||
      mechanismId?.startsWith("front_") === true
    );
  }
  if (end === "rear") {
    return (
      lower.includes("rear") ||
      lower.includes("_rf") ||
      lower.includes("_rr") ||
      mechanismId?.startsWith("rear_") === true
    );
  }
  return true;
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
  if (problem.diagnosisConfidence === "high") score += 2;
  else if (problem.diagnosisConfidence === "medium") score += 1;
  if (problem.confounders.length >= 2) score -= 1;
  if (problem.recommendationMode === "diagnose") score -= 2;

  if (score >= 5) return "high";
  if (score >= 3) return "moderate";
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
  const filtered = input.matches.filter((m) =>
    matchesEndFilter(m.parameterKey, primaryMechanismForKey(m.parameterKey), input.problem.end)
  );

  const graded = filtered.map((m) => gradeSingleLever(m, input.problem));

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
