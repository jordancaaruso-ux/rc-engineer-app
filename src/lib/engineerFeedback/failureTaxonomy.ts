/**
 * Suggestion-failure taxonomy — ENGINEER_SUGGESTION_QUALITY_PLAN.md, step 1.
 *
 * The plan refuses to rank its keystones by argument: the *failure distribution*
 * across four canonical classes decides whether the diagnosis layer or the
 * calibration loop earns the next build cycle ("numbers first"). This module is the
 * shared vocabulary + the free, deterministic mapping from the existing calibrated-judge
 * tags onto those four classes. The LLM rubric-decomposed classifier (failureClassifier.ts)
 * adds the one class the judge is blind to — `misdiagnosis`.
 *
 * Pure + dependency-light on purpose (only a type import): the report script can
 * aggregate existing bench result files with no DB, no OpenAI, no env.
 */

import type { JudgeTag } from "./calibratedJudge";

/**
 * The four canonical failure classes the plan decides among. Deliberately exactly the
 * plan's four — finer signals (missing prediction, wrong physics, missing citation) are
 * tracked separately as SecondaryFailureSignal, never folded in, so the keystone
 * decision reads off a clean four-way axis.
 */
export type FailureClass =
  /** Wrong or absent read of what the car is doing and *why*. The knowledge + diagnosis
   *  layer's failure. NOT derivable from judge tags — only the LLM classifier sees it. */
  | "misdiagnosis"
  /** Confidence not matched to the evidence — false confidence (worse) OR over-hedging. */
  | "miscalibration"
  /** Ignores THIS driver's runs / setup / context; advice anyone could have googled. */
  | "genericness"
  /** Many simultaneous changes instead of one prioritized, testable call. */
  | "laundry_list";

/** Worst-first, per the north-star failure ranking (diagnosis-layer failure treated as
 *  most disqualifying because it poisons everything downstream). Drives `primaryFailure`. */
export const FAILURE_CLASSES: readonly FailureClass[] = [
  "misdiagnosis",
  "miscalibration",
  "genericness",
  "laundry_list",
];

/**
 * Real failures that matter but are NOT part of the four-way keystone decision:
 * - no_prediction — violates prediction discipline (north star), but orthogonal to the
 *   diagnosis-vs-calibration question.
 * - wrong_physics — a knowledge error; diagnosis-adjacent but distinct from misreading a
 *   symptom. Reported beside misdiagnosis as the "knowledge-layer" total.
 * - missing_kb_citation — grounding hygiene.
 */
export type SecondaryFailureSignal = "no_prediction" | "wrong_physics" | "missing_kb_citation";

export const SECONDARY_FAILURE_SIGNALS: readonly SecondaryFailureSignal[] = [
  "no_prediction",
  "wrong_physics",
  "missing_kb_citation",
];

/**
 * Judge tag → canonical failure class. Partial by design:
 *
 * There is intentionally NO tag that maps to `misdiagnosis` — the calibrated judge has
 * no misdiagnosis tag, so this free pass over already-judged bench results is
 * structurally blind to it. That blindness IS the plan's central point: the current eval
 * cannot see the failure mode the diagnosis keystone would fix. A 0 misdiagnosis count
 * from tag-mapping means "unmeasured", never "absent" — only failureClassifier.ts can
 * measure it. See MISDIAGNOSIS_MEASURABLE_FROM_TAGS.
 */
const TAG_TO_CLASS: Partial<Record<JudgeTag, FailureClass>> = {
  false_confidence: "miscalibration",
  over_hedged: "miscalibration",
  generic_advice: "genericness",
  ignored_context: "genericness",
  laundry_list: "laundry_list",
  // wrong_physics, no_prediction, missing_kb_citation → SecondaryFailureSignal, not a class.
};

/** False → tag-mapping cannot detect misdiagnosis; the report must say so out loud. */
export const MISDIAGNOSIS_MEASURABLE_FROM_TAGS = false;

/** All failure classes present in an answer, per its existing judge tags (worst-first order). */
export function judgeTagsToFailureClasses(tags: readonly JudgeTag[]): FailureClass[] {
  const present = new Set<FailureClass>();
  for (const t of tags) {
    const c = TAG_TO_CLASS[t];
    if (c) present.add(c);
  }
  return FAILURE_CLASSES.filter((c) => present.has(c));
}

/** Secondary signals present, per existing judge tags. */
export function judgeTagsToSecondarySignals(tags: readonly JudgeTag[]): SecondaryFailureSignal[] {
  return SECONDARY_FAILURE_SIGNALS.filter((s) => (tags as readonly string[]).includes(s));
}

/** The single worst failure present, or null if the answer carries none. */
export function primaryFailureFromClasses(classes: readonly FailureClass[]): FailureClass | null {
  return FAILURE_CLASSES.find((c) => classes.includes(c)) ?? null;
}

// --- Distribution aggregation -------------------------------------------------

export type FailureDistribution = {
  /** Answers considered (judged, non-error). */
  total: number;
  /** Answers with no failure class present. */
  cleanCount: number;
  /** Multi-label: an answer with two failures increments two entries. */
  byClass: Record<FailureClass, number>;
  /** Single worst failure per answer — sums (with cleanCount) to `total`. */
  byPrimary: Record<FailureClass, number>;
  bySecondary: Record<SecondaryFailureSignal, number>;
};

export function emptyDistribution(): FailureDistribution {
  const zeroClasses = () =>
    Object.fromEntries(FAILURE_CLASSES.map((c) => [c, 0])) as Record<FailureClass, number>;
  return {
    total: 0,
    cleanCount: 0,
    byClass: zeroClasses(),
    byPrimary: zeroClasses(),
    bySecondary: Object.fromEntries(SECONDARY_FAILURE_SIGNALS.map((s) => [s, 0])) as Record<
      SecondaryFailureSignal,
      number
    >,
  };
}

/** Fold one answer's classified failures into a running distribution (mutates + returns it). */
export function addToDistribution(
  dist: FailureDistribution,
  classes: readonly FailureClass[],
  secondary: readonly SecondaryFailureSignal[]
): FailureDistribution {
  dist.total += 1;
  if (classes.length === 0) dist.cleanCount += 1;
  for (const c of classes) dist.byClass[c] += 1;
  const primary = primaryFailureFromClasses(classes);
  if (primary) dist.byPrimary[primary] += 1;
  for (const s of secondary) dist.bySecondary[s] += 1;
  return dist;
}

/**
 * Knowledge-layer failure total = misdiagnosis (primary) + wrong_physics (secondary).
 * The plan reads this against miscalibration to settle the diagnosis-vs-calibration
 * keystone question. Returns the count and whether misdiagnosis was measurable at all.
 */
export function knowledgeLayerFailureCount(dist: FailureDistribution): {
  count: number;
  misdiagnosisMeasured: boolean;
} {
  return {
    count: dist.byClass.misdiagnosis + dist.bySecondary.wrong_physics,
    misdiagnosisMeasured: dist.byClass.misdiagnosis > 0 || MISDIAGNOSIS_MEASURABLE_FROM_TAGS,
  };
}
