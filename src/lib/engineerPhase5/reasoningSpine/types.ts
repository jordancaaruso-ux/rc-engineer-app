import "server-only";

import type { EngineeringReadV1 } from "@/lib/engineerPhase5/engineeringRead";
import type { Outcome, OutcomeDirection } from "@/lib/engineerPhase5/parameterEffects/types";
import type { SetupMechanismId } from "@/lib/engineerPhase5/setupMechanismMap";

/** What kind of question the user is asking — drives context + narration path. */
export type EngineerRoute =
  | "setup_advice"
  | "planning"
  | "data_query"
  | "comparison"
  | "conceptual";

export type DecisionTier = "engine_decides" | "grounded_reasoner_fallback";

export type EvidenceCertainty = "high" | "moderate" | "low" | "very_low";

export type OverallRecommendationGrade = "strong" | "conditional" | "weak";

export type ProblemEnd = "front" | "rear" | "both" | "unknown";
export type ProblemPhase = "entry" | "mid" | "exit" | "whole_corner" | "unknown";

/**
 * Localized problem statement derived from engineeringRead + optional outcome intent.
 * This is the diagnosis spine output — prescribe only after this is set.
 */
export type ProblemStatementV1 = {
  version: 1;
  /** Closed outcome goal when intent classifier matched; null for symptom-only messages. */
  goalOutcome: Outcome | null;
  goalDirection: OutcomeDirection | null;
  matchedPhrase: string | null;
  end: ProblemEnd;
  phase: ProblemPhase;
  severity: "mild" | "moderate" | "severe" | "unknown";
  balanceSign: "understeer" | "oversteer" | "neutral" | "mixed" | "unknown";
  paceFeelAgreement: EngineeringReadV1["paceRead"]["paceFeelAgreement"];
  confounders: string[];
  diagnosisConfidence: "high" | "medium" | "low";
  recommendationMode: EngineeringReadV1["recommendationStrategy"]["mode"];
};

export type GradedLeverV1 = {
  parameterKey: string;
  mechanismId: SetupMechanismId | null;
  recommendedMoveDirection: "up" | "down";
  kbSource: string;
  kbSection: string;
  effectStrength: "weak" | "moderate" | "strong";
  effectHedged: boolean;
  evidenceCertainty: EvidenceCertainty;
  overallGrade: OverallRecommendationGrade;
  userCurrent: number | null;
  communityMedian: number | null;
  positionBand: string | null;
  hedgedDirectionAtPosition: boolean;
  caveats: string[];
};

export type ReasoningSpineV1 = {
  version: 1;
  route: EngineerRoute;
  decisionTier: DecisionTier;
  problemStatement: ProblemStatementV1 | null;
  gradedLevers: GradedLeverV1[];
  /** Deterministic lines for the LLM narrator — do not re-derive diagnosis from raw JSON. */
  promptLines: string[];
  /** Short label for UI/debug. */
  tierReason: string;
};
