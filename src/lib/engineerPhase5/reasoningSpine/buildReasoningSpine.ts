import "server-only";

import type { EngineeringReadV1 } from "@/lib/engineerPhase5/engineeringRead";
import type { ParameterIntentMatches } from "@/lib/engineerPhase5/parameterEffects/types";
import { applyPersonalCertaintyModulators } from "@/lib/engineerPhase5/reasoningSpine/certaintyModulators";
import { buildGradedLevers } from "@/lib/engineerPhase5/reasoningSpine/gradeLevers";
import type { SetupOutcomeMemoryV1 } from "@/lib/engineerPhase5/setupOutcomeMemory";
import { buildProblemStatementV1 } from "@/lib/engineerPhase5/reasoningSpine/problemStatement";
import { routeEngineerMessage } from "@/lib/engineerPhase5/reasoningSpine/routeMessage";
import type {
  DecisionTier,
  GradedLeverV1,
  PhaseProfileEntryV1,
  ProblemShape,
  ProblemStatementV1,
  ReasoningSpineV1,
} from "@/lib/engineerPhase5/reasoningSpine/types";

function pickDecisionTier(input: {
  route: ReasoningSpineV1["route"];
  problem: ProblemStatementV1 | null;
  gradedLevers: GradedLeverV1[];
}): { tier: DecisionTier; reason: string } {
  if (input.route !== "setup_advice") {
    return {
      tier: "grounded_reasoner_fallback",
      reason: `route=${input.route} — LLM narrates with spine diagnosis only`,
    };
  }
  if (!input.problem) {
    return { tier: "grounded_reasoner_fallback", reason: "no engineering read for diagnosis" };
  }
  if (input.problem.recommendationMode === "diagnose") {
    return {
      tier: "grounded_reasoner_fallback",
      reason: "diagnose-first mode — explain before prescribing",
    };
  }
  if (input.problem.diagnosisConfidence === "low") {
    return {
      tier: "grounded_reasoner_fallback",
      reason: "low diagnosis confidence or confounders",
    };
  }
  if (input.gradedLevers.length === 0) {
    return {
      tier: "grounded_reasoner_fallback",
      reason: "parameter-effect catalog has no approved matches for this intent",
    };
  }
  const actionable = input.gradedLevers.filter(
    (l) =>
      l.overallGrade !== "weak" &&
      l.evidenceCertainty !== "very_low" &&
      !l.hedgedDirectionAtPosition
  );
  if (actionable.length === 0) {
    return {
      tier: "grounded_reasoner_fallback",
      reason: "no lever cleared evidence + position gates",
    };
  }
  return {
    tier: "engine_decides",
    reason: `${actionable.length} catalog lever(s) with adequate evidence`,
  };
}

function formatLeverLine(lever: GradedLeverV1, index: number): string {
  const dir = lever.recommendedMoveDirection === "up" ? "raise" : "lower";
  const pos =
    lever.positionBand != null ? `, positionBand=${lever.positionBand}` : "";
  const caveats =
    lever.caveats.length > 0 ? ` Caveats: ${lever.caveats.join(" ")}` : "";
  return (
    `${index + 1}. ${lever.parameterKey}: ${dir} (${lever.overallGrade}, ` +
    `effect=${lever.effectStrength}, certainty=${lever.evidenceCertainty}) ` +
    `[${lever.kbSource}#${lever.kbSection}]${pos}.${caveats}`
  );
}

function formatPhaseEntry(e: PhaseProfileEntryV1): string {
  const signed = e.value > 0 ? `+${e.value}` : String(e.value);
  return `${e.phase} ${signed} ${e.severity} ${e.direction} (${e.end})`;
}

/**
 * The phases the driver actually flagged, worst first. Before 2026-08-01 the spine printed
 * only the winner, so a car loose at entry, mid AND exit reached the model as `phase=exit`
 * and the other two were never recoverable from this line.
 */
function formatPhaseProfileLine(p: ProblemStatementV1): string | null {
  if (p.phaseProfile.length === 0) return null;
  const [lead, ...rest] = p.phaseProfile;
  const also = rest.length > 0 ? ` Also flagged: ${rest.map(formatPhaseEntry).join("; ")}.` : "";
  return `Phases (worst first): lead ${formatPhaseEntry(lead!)}.${also} Shape=${p.shape}.`;
}

/**
 * What the shape means for the SHAPE OF THE ANSWER. This is the line that decides whether
 * stacking two levers is the right call or the trap — it is guidance about strategy, never
 * about which specific knob to turn.
 */
const SHAPE_GUIDANCE: Record<ProblemShape, string | null> = {
  whole_corner:
    "WHOLE-CORNER PROBLEM: every flagged phase leans the same way, so this is one underlying problem showing up across the corner — worst at the lead phase, but present in all of them. Lead with the phase that is worst; do NOT present it as the only problem. A lever that acts through the whole corner is the base of the answer, and a phase-specific lever may be stacked on top of it for the lead phase — say plainly that you are stacking, and which part each change is aimed at.",
  split:
    "SPLIT PROBLEM: the flagged phases lean OPPOSITE ways, so this is rotation timing rather than one end simply being short of grip. A lever that acts through the whole corner moves both phases the same way and will trade one problem for the other — if you raise one, say so rather than presenting it as a fix. Prefer levers aimed at a single phase, or a change to how quickly load moves between the ends.",
  localized:
    "LOCALIZED PROBLEM: one flagged phase only. Prefer a lever that acts in that phase over one that acts through the whole corner.",
  unknown: null,
};

function buildPromptLines(input: {
  route: ReasoningSpineV1["route"];
  tier: DecisionTier;
  tierReason: string;
  problem: ProblemStatementV1 | null;
  gradedLevers: GradedLeverV1[];
}): string[] {
  const lines: string[] = [];
  lines.push(`Reasoning spine route: ${input.route}. Decision tier: ${input.tier} (${input.tierReason}).`);

  if (input.problem) {
    const p = input.problem;
    const goal =
      p.goalOutcome != null
        ? `Goal: ${p.goalDirection} ${p.goalOutcome}${p.matchedPhrase ? ` (matched "${p.matchedPhrase}")` : ""}.`
        : "Goal: symptom-driven (no closed outcome intent matched).";
    lines.push(
      `Problem: ${goal} End=${p.end}, leadPhase=${p.phase}, severity=${p.severity}, ` +
        `balance=${p.balanceSign}, diagnosisConfidence=${p.diagnosisConfidence}, ` +
        `mode=${p.recommendationMode}.`
    );
    const profileLine = formatPhaseProfileLine(p);
    if (profileLine) lines.push(profileLine);
    const guidance = SHAPE_GUIDANCE[p.shape];
    if (guidance) lines.push(guidance);
    if (p.confounders.length > 0) {
      lines.push(`Confounders: ${p.confounders.join(" ")}`);
    }
  }

  if (input.gradedLevers.length > 0) {
    lines.push("Graded levers (engine ordering — do not reorder in engine_decides tier):");
    input.gradedLevers.forEach((l, i) => lines.push(formatLeverLine(l, i)));
  } else if (input.route === "setup_advice") {
    lines.push(
      "No catalogued levers for this intent — use vehicleDynamicsKb + setupVsSpread; hedge heavily."
    );
  }

  if (input.tier === "engine_decides") {
    lines.push(
      "ENGINE TIER: Recommend ONLY the graded levers above, in order. Do not add, remove, or reverse directions."
    );
  } else {
    lines.push(
      "FALLBACK TIER: Use problem statement + engineeringBrain for diagnosis; you may propose levers beyond the catalog when coverage is incomplete, but cite KB and hedge."
    );
  }

  return lines;
}

export function buildReasoningSpineV1(input: {
  userMessage: string;
  engineeringRead: EngineeringReadV1 | null;
  parameterIntentMatches: ParameterIntentMatches | null;
  setupOutcomeMemory?: SetupOutcomeMemoryV1 | null;
}): ReasoningSpineV1 {
  const route = routeEngineerMessage(input.userMessage);
  const problem =
    input.engineeringRead != null
      ? buildProblemStatementV1({
          engineeringRead: input.engineeringRead,
          userMessage: input.userMessage,
        })
      : null;

  const gradedLeversRaw =
    problem != null && input.parameterIntentMatches?.matches.length
      ? buildGradedLevers({
          matches: input.parameterIntentMatches.matches,
          problem,
        })
      : [];
  const gradedLevers = applyPersonalCertaintyModulators(
    gradedLeversRaw,
    input.setupOutcomeMemory ?? null
  );

  const { tier, reason } = pickDecisionTier({ route, problem, gradedLevers });
  const promptLines = buildPromptLines({
    route,
    tier,
    tierReason: reason,
    problem,
    gradedLevers,
  });

  return {
    version: 1,
    route,
    decisionTier: tier,
    problemStatement: problem,
    gradedLevers,
    promptLines,
    tierReason: reason,
  };
}
