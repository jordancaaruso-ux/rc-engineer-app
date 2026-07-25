/**
 * Builds VALID v6 handling assessments for synthetic runs.
 *
 * Two traps in the real parser (src/lib/runHandlingAssessment.ts) that a naive generator
 * falls into silently:
 *   1. `primaryFocus` is DROPPED unless its value exactly equals the field it points at
 *      (primaryFocusMatchesParsed).
 *   2. `speedTags` are PRUNED unless the underlying issue is actually set (pruneSpeedTags).
 * Either mistake produces a blob that parses to something thinner than intended, so the
 * engine silently loses symptom signal and we'd blame the answer. `handlingBuilder.test.ts`
 * round-trips every problem type through the REAL parser to prove nothing is dropped.
 *
 * Problem poles (from HANDLING_TRAIT_CHIP_META): onPower/braking/driveEase flag NEGATIVE,
 * tractionRoll flags POSITIVE, feelSteering is bipolar (dull −, darty +).
 */
import type {
  PhaseBalance,
  PrimaryFocus,
  RunHandlingAssessmentParsed,
  SpeedTagMap,
} from "@/lib/runHandlingAssessment";
import type { ProblemTypeId } from "./types";

export type HandlingSpec = {
  assessment: RunHandlingAssessmentParsed;
  /** Plain-English complaint for handlingProblems when chips aren't filled. */
  complaintHint: string;
};

const clamp = (n: number): PhaseBalance => Math.max(-3, Math.min(3, Math.round(n))) as PhaseBalance;

/**
 * Severity scales the flagged pole. `feelVsLastRun` is set by the caller (it describes
 * the delta between runs, not the symptom itself).
 */
export function buildHandlingForProblem(
  problem: ProblemTypeId,
  severity: 1 | 2 | 3 = 2
): HandlingSpec {
  const s = clamp(severity);
  const neg = clamp(-severity);
  const a: RunHandlingAssessmentParsed = { version: 6 };
  let focus: PrimaryFocus | null = null;
  let complaintHint = "";

  switch (problem) {
    case "entry-understeer":
      a.balanceByPhase = { entry: neg };
      focus = { kind: "balance", phase: "entry", value: neg };
      complaintHint = "won't turn in, pushing wide on entry";
      break;
    case "mid-understeer":
      a.balanceByPhase = { mid: neg };
      focus = { kind: "balance", phase: "mid", value: neg };
      complaintHint = "pushing mid-corner, won't hold the line";
      break;
    case "exit-oversteer":
      a.balanceByPhase = { exit: s };
      focus = { kind: "balance", phase: "exit", value: s };
      complaintHint = "rear steps out on exit";
      break;
    case "on-power-snap":
      a.balanceByPhase = { exit: s };
      a.onPower = neg;
      focus = { kind: "on_power", value: neg };
      complaintHint = "snaps loose the moment I get on the throttle";
      break;
    case "traction-roll":
      a.tractionRoll = s;
      focus = { kind: "traction_roll", value: s };
      complaintHint = "tripping over itself in the tight stuff";
      break;
    case "braking-loose":
      a.braking = neg;
      a.balanceByPhase = { entry: s };
      focus = { kind: "braking", value: neg };
      complaintHint = "rear comes around under brakes";
      break;
    case "darty":
      a.feelSteering = s;
      focus = { kind: "feel_steering", value: s };
      complaintHint = "too darty, hard to place accurately";
      break;
    case "inconsistent":
      a.driveEase = neg;
      focus = { kind: "drive_ease", value: neg };
      complaintHint = "on edge, one lap good one lap bad";
      break;
    case "tires-going-off":
      a.balanceByPhase = { mid: neg };
      a.driveEase = neg;
      focus = { kind: "drive_ease", value: neg };
      complaintHint = "went away over the run, no grip by the end";
      break;
    case "nothing-wrong":
      // Deliberately near-empty: the "it felt great, what now?" bait. A lone
      // feelVsLastRun keeps the blob meaningful (v5HasAnyContent) without a flagged issue.
      a.feelVsLastRun = 2;
      complaintHint = "felt great, best it's been";
      break;
  }

  if (focus) a.primaryFocus = focus;
  return { assessment: a, complaintHint };
}

/** Attach a corner-speed tag, but only where the underlying issue is set (else pruned). */
export function withSpeedTag(
  spec: HandlingSpec,
  speed: "slow" | "fast" | "both"
): HandlingSpec {
  const a = spec.assessment;
  const tags: SpeedTagMap = {};
  if (a.balanceByPhase?.entry != null) tags["balance:entry"] = speed;
  if (a.balanceByPhase?.mid != null) tags["balance:mid"] = speed;
  if (a.balanceByPhase?.exit != null) tags["balance:exit"] = speed;
  if (a.onPower != null) tags["trait:onPower"] = speed;
  if (a.braking != null) tags["trait:braking"] = speed;
  if (a.tractionRoll != null) tags["trait:tractionRoll"] = speed;
  if (a.driveEase != null) tags["trait:driveEase"] = speed;
  if (a.feelSteering != null) tags["trait:feelSteering"] = speed;
  if (Object.keys(tags).length === 0) return spec;
  return { ...spec, assessment: { ...a, speedTags: tags } };
}

/** Set how this run felt vs the previous one (−3 much worse … +3 much better). */
export function withFeelVsLastRun(spec: HandlingSpec, feel: number): HandlingSpec {
  return { ...spec, assessment: { ...spec.assessment, feelVsLastRun: clamp(feel) } };
}
