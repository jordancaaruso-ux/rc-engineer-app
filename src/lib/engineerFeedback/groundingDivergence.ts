/**
 * Differential grounding metric — ENGINEER_SUGGESTION_QUALITY_PLAN.md step 1, context-
 * diversity refinement (2026-07-08, founder critique: "we only ever analyze responses
 * given the same context — my recent runs").
 *
 * The whole bench answers every case against ONE context (the founder's latest run), so
 * "genericness" can't be measured — a model looks grounded by reciting the same run, or
 * generic because a question doesn't intersect it. The fix: run the SAME probe against
 * SEVERAL contexts and measure whether the answer adapts.
 *
 * - A **context-sensitive** probe (symptom / "what should I change") SHOULD produce
 *   different, context-appropriate answers. Near-identical answers across contexts = the
 *   objective genericness signal.
 * - A **context-invariant** probe (physics / teaching, "what does damper oil do") SHOULD
 *   produce stable answers — this is the class the LLM classifier over-tagged as generic
 *   for not citing the driver's data. Divergence here is *inconsistency*, a different bug.
 *
 * Pure + dependency-free so it unit-tests offline. The similarity proxy (bigram Jaccard)
 * measures textual adaptation, NOT correctness — a necessary, not sufficient, grounding
 * signal. Thresholds are heuristic and exported for calibration once real sweeps land.
 */

/** Whether a probe's answer SHOULD move with context. */
export type ContextSensitivity = "sensitive" | "invariant";

export type GroundingReport = {
  n: number;
  /** Mean pairwise bigram-Jaccard similarity across the answers (0 = all different, 1 = identical). */
  meanSimilarity: number;
  /** 1 - meanSimilarity. High = answers adapt to context. */
  divergence: number;
  /** Pairs (by index) whose similarity ≥ NEAR_DUPLICATE_SIMILARITY — candidate generic repeats. */
  nearDuplicatePairs: Array<[number, number]>;
};

export type GroundingVerdict =
  | "grounded" // sensitive probe, answers adapted
  | "generic" // sensitive probe, answers barely moved across contexts
  | "consistent" // invariant probe, answers stable (correct)
  | "inconsistent"; // invariant probe, answers moved when they shouldn't

/** A sensitive probe below this divergence didn't adapt → generic. */
export const SENSITIVE_MIN_DIVERGENCE = 0.4;
/** An invariant probe above this divergence moved when it shouldn't → inconsistent. */
export const INVARIANT_MAX_DIVERGENCE = 0.6;
/** Pairwise similarity at/above this flags two answers as near-duplicate. */
export const NEAR_DUPLICATE_SIMILARITY = 0.6;

// Common engineer/answer boilerplate + English stopwords that inflate baseline similarity
// (every answer says "I'd try", "expected", "the", etc.). Stripped so divergence reflects
// substantive content, not shared scaffolding.
const STOPWORDS = new Set(
  ("a an the and or but if then to of in on for with your you it is are be that this " +
    "i'd id try test would could should more less on-power expected effect feel change " +
    "run car front rear the a").split(/\s+/)
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, " ") // drop code spans (parameter keys) — shared across answers
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Set of adjacent-word bigrams — captures phrasing, not just vocabulary. */
function bigrams(tokens: string[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) set.add(tokens[i] + " " + tokens[i + 1]);
  // Single-token fallback so very short answers still compare.
  if (tokens.length === 1) set.add(tokens[0]);
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Divergence report over a set of answers to the SAME probe under different contexts. */
export function groundingReport(answers: readonly string[]): GroundingReport {
  const grams = answers.map((a) => bigrams(tokenize(a)));
  const pairs: number[] = [];
  const dupes: Array<[number, number]> = [];
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 1; j < grams.length; j++) {
      const s = jaccard(grams[i], grams[j]);
      pairs.push(s);
      if (s >= NEAR_DUPLICATE_SIMILARITY) dupes.push([i, j]);
    }
  }
  const meanSimilarity = pairs.length ? pairs.reduce((s, v) => s + v, 0) / pairs.length : 1;
  return {
    n: answers.length,
    meanSimilarity: Math.round(meanSimilarity * 1000) / 1000,
    divergence: Math.round((1 - meanSimilarity) * 1000) / 1000,
    nearDuplicatePairs: dupes,
  };
}

/** Turn a divergence number into a verdict, given what the probe SHOULD do. */
export function groundingVerdict(sensitivity: ContextSensitivity, divergence: number): GroundingVerdict {
  if (sensitivity === "sensitive") {
    return divergence < SENSITIVE_MIN_DIVERGENCE ? "generic" : "grounded";
  }
  return divergence > INVARIANT_MAX_DIVERGENCE ? "inconsistent" : "consistent";
}

/** A verdict is a failure iff it's generic (sensitive, didn't adapt) or inconsistent. */
export function groundingVerdictIsFailure(v: GroundingVerdict): boolean {
  return v === "generic" || v === "inconsistent";
}
