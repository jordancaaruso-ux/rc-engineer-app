import "server-only";

import type { ComparableRun } from "@/lib/engineerPhase5/comparableRunScore";
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

/**
 * The LEAD phase only — the worst one by chip magnitude. It is never the whole story:
 * read `ProblemStatementV1.phaseProfile` for every flagged phase and `shape` for how
 * they relate. (`whole_corner` used to live on this union and nothing ever produced it;
 * that concept is now `ProblemShape`, where it can actually be derived.)
 */
export type ProblemPhase = "entry" | "mid" | "exit" | "unknown";

/**
 * How the flagged phases relate to each other. This is what decides whether stacking a
 * broad lever on top of a phase-specific one is the right answer or a trap:
 *
 *  `whole_corner` — every flagged phase leans the SAME way. One underlying problem showing
 *                   up across the corner, worst at the lead phase. A lever that acts in all
 *                   phases is the base of the fix; a phase-specific one can stack on top.
 *  `split`        — flagged phases lean OPPOSITE ways (pushes on entry, snaps on exit).
 *                   This is rotation timing, not one end short of grip, and a whole-corner
 *                   lever moves both phases together — it trades one problem for the other.
 *  `localized`    — exactly one phase flagged.
 *  `unknown`      — nothing flagged.
 */
export type ProblemShape = "whole_corner" | "split" | "localized" | "unknown";

/**
 * One flagged corner phase. Neutral (0) phases are not problems and never appear here.
 *
 * `end` is derived from the direction the phase leans: understeer is the front giving up,
 * oversteer is the rear. Carried per-phase because a `split` genuinely has two ends, and
 * collapsing that to one scalar is what produced `end=unknown` on the most diagnosable
 * fault in the sport.
 */
export type PhaseProfileEntryV1 = {
  phase: "entry" | "mid" | "exit";
  /** Raw chip value, −3…+3. Negative = understeer, positive = oversteer. Never 0. */
  value: number;
  severity: "mild" | "moderate" | "severe";
  direction: "understeer" | "oversteer";
  end: "front" | "rear";
};

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
  /** End owning the LEAD phase; `both` on a split, where two ends are genuinely in play. */
  end: ProblemEnd;
  /** Worst phase by magnitude. Priority, not exclusivity — see `phaseProfile`. */
  phase: ProblemPhase;
  /** Every flagged phase, worst first. Empty when the driver flagged none. */
  phaseProfile: PhaseProfileEntryV1[];
  /** How the flagged phases relate — drives whether levers stack or trade off. */
  shape: ProblemShape;
  /**
   * Severity of the LEAD phase's balance. Before 2026-08-01 this read the "feel vs last
   * run" chip instead, so it described a different axis than the phase it sat beside.
   */
  severity: "mild" | "moderate" | "severe" | "unknown";
  balanceSign: "understeer" | "oversteer" | "neutral" | "mixed" | "unknown";
  paceFeelAgreement: EngineeringReadV1["paceRead"]["paceFeelAgreement"];
  confounders: string[];
  /**
   * `diagnosisConfidence` REMOVED 2026-08-04 (founder: "diagnosis confidence is dumb").
   * It graded certainty by counting reasons to doubt — tyre change, track change, too many
   * keys moved — so a driver with no history tripped none of them and scored "high". The
   * app was most certain about the drivers it knew least, and then told the model it did
   * not need to hedge. Replaced by a fact rather than a grade: `comparableRuns` carries the
   * nearest run on file and how close it is on tyre, grip and layout, in plain words.
   */
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
  /**
   * Past runs on this car whose conditions are nearest to the one in focus, closest first,
   * each carrying how near it is in plain words. This is what the model calibrates its
   * certainty against now that the graded confidence field is gone — a fact about what is
   * on file, not a verdict about how sure to be.
   */
  comparableRuns: ComparableRun[];
  /** Deterministic lines for the LLM narrator — do not re-derive diagnosis from raw JSON. */
  promptLines: string[];
  /** Short label for UI/debug. */
  tierReason: string;
};
