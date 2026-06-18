/**
 * The "missing middle" layer: MECHANISM → how the car drives.
 *
 * The codebase already knows PARAMETER → MECHANISM (setupMechanismMap.ts:
 * "this shim raises rear roll centre", "this spring adds rear support"). What it
 * never had was MECHANISM → OUTCOME ("more rear support does X to mid-corner rear
 * grip"). Without it, the only way to know what a part does to handling was the
 * flat PARAMETER → OUTCOME catalog (parameterEffects/catalog.ts) — which forced
 * the same physics to be re-typed for every part that shares a mechanism, threw
 * away corner phase + conditions, and could silently contradict itself.
 *
 * This module closes the gap. You author the physics ONCE per mechanism here,
 * and `deriveOutcomesForParameter` COMPOSES it with the existing
 * parameter→mechanism map to produce parameter→outcome automatically — sign-
 * correct (a part that *reduces* a mechanism flips the outcome), phase-aware,
 * and with hedges/conditions preserved.
 *
 * AUTHORING IS HUMAN-GATED — same rule as content/vehicle-dynamics/ and
 * parameterEffects/catalog.ts:
 *   1. Do NOT add/edit/remove a MECHANISM_OUTCOME_CATALOG entry without explicit
 *      user approval in the triggering chat message.
 *   2. Every entry's `dir`, `hedge`, `strength`, `phase` MUST trace to KB prose
 *      at the cited `kbSource` + `kbSection` — quote the line in the proposal.
 *   3. Ships EMPTY on purpose. With no entries, derivation returns nothing and
 *      the Engineer falls through to prose retrieval, exactly as today.
 *
 * The validator (`validateMechanismOutcomeCatalog`) and the proof test
 * (`mechanismOutcomes.test.ts`) are the machine around this data; they are NOT
 * gated and can be iterated freely.
 */

import {
  mechanismsForKey,
  type SetupMechanismDirection,
  type SetupMechanismId,
} from "@/lib/engineerPhase5/setupMechanismMap";
// Type-only imports are erased at runtime, so pulling these from the
// server-only `./types` module does NOT trigger its `import "server-only"`
// side effect — keeping this module importable from the tsx test runner.
import type {
  EffectDirection,
  EffectStrength,
  Outcome,
  OutcomeDirection,
} from "./types";

/** Which part of the corner the effect applies to. `all` = phase-independent. */
export type CornerPhase = "entry" | "mid" | "exit" | "on_power" | "all";

/**
 * One authored claim: "when this MECHANISM increases, this OUTCOME moves this
 * way, in this phase of the corner." Composed with parameter→mechanism to get
 * parameter→outcome.
 */
export type MechanismOutcomeEntry = {
  mechanism: SetupMechanismId;
  outcome: Outcome;
  phase: CornerPhase;
  /**
   * Direction of the OUTCOME when the MECHANISM *increases* (e.g. "more rear
   * support"). "+" = outcome rises, "-" = outcome falls.
   */
  dir: EffectDirection;
  /** True when the KB hedges this ("sometimes", "depending on balance", "test it"). */
  hedge: boolean;
  strength: EffectStrength;
  /** When the effect changes — grip level, tyre wear, surface, corner type. */
  conditions?: string;
  /** KB file under content/vehicle-dynamics/ this claim derives from. */
  kbSource: string;
  /** Slugified `## Heading` anchor in that file. */
  kbSection: string;
  notes?: string;
};

/**
 * AUTHORED CONTENT — human-gated (see file header). Ships empty.
 */
export const MECHANISM_OUTCOME_CATALOG: readonly MechanismOutcomeEntry[] = [
  // Authored one mechanism at a time, each gated on explicit user approval.
];

/** Result of composing one parameter with the mechanism→outcome catalog. */
export type DerivedParameterOutcome = {
  parameterKey: string;
  mechanism: SetupMechanismId;
  outcome: Outcome;
  phase: CornerPhase;
  /** Direction of the OUTCOME when the PARAMETER's stored value *increases*. */
  dir: EffectDirection;
  hedge: boolean;
  strength: EffectStrength;
  conditions?: string;
  kbSource: string;
  kbSection: string;
};

/**
 * A derived lever resolved against a goal (e.g. "more rear grip"): which way to
 * move the parameter to push the outcome the user's requested direction.
 */
export type GoalLever = DerivedParameterOutcome & {
  recommendedMoveDirection: "up" | "down";
};

const STRENGTH_ORDER: Record<EffectStrength, number> = {
  strong: 3,
  moderate: 2,
  weak: 1,
};

/**
 * +1 when raising the parameter *increases* the mechanism, -1 when it
 * *decreases* it. This is what makes derivation sign-correct: a part that
 * reduces rear support flips the outcome that "more rear support" would cause.
 */
const MECHANISM_INCREASE_SIGN: Record<SetupMechanismDirection, 1 | -1> = {
  raises: 1,
  stiffens: 1,
  more: 1,
  lowers: -1,
  softens: -1,
  less: -1,
};

function flipIfNegative(dir: EffectDirection, sign: 1 | -1): EffectDirection {
  if (sign === 1) return dir;
  return dir === "+" ? "-" : "+";
}

/**
 * Compose parameter→mechanism (setupMechanismMap) with mechanism→outcome (this
 * catalog) to produce every outcome a single parameter affects. Empty when the
 * parameter has no mechanism mapping or no mechanism it touches is catalogued.
 */
export function deriveOutcomesForParameter(
  parameterKey: string,
  catalog: readonly MechanismOutcomeEntry[] = MECHANISM_OUTCOME_CATALOG
): DerivedParameterOutcome[] {
  const mechanisms = mechanismsForKey(parameterKey);
  if (mechanisms.length === 0) return [];

  const out: DerivedParameterOutcome[] = [];
  for (const m of mechanisms) {
    const sign = MECHANISM_INCREASE_SIGN[m.whenIncreasedEffect];
    for (const entry of catalog) {
      if (entry.mechanism !== m.mechanism) continue;
      out.push({
        parameterKey,
        mechanism: entry.mechanism,
        outcome: entry.outcome,
        phase: entry.phase,
        dir: flipIfNegative(entry.dir, sign),
        hedge: entry.hedge,
        strength: entry.strength,
        conditions: entry.conditions,
        kbSource: entry.kbSource,
        kbSection: entry.kbSection,
      });
    }
  }
  return out;
}

/**
 * Resolve a goal (outcome + desired direction) over a set of candidate
 * parameters into ranked levers, each tagged with which way to move it.
 * `parameterKeys` are the keys in play (e.g. the user's setup-sheet rows).
 */
export function deriveLeversForGoal(args: {
  outcome: Outcome;
  direction: OutcomeDirection;
  parameterKeys: readonly string[];
  catalog?: readonly MechanismOutcomeEntry[];
}): GoalLever[] {
  const { outcome, direction, parameterKeys } = args;
  const catalog = args.catalog ?? MECHANISM_OUTCOME_CATALOG;
  const userWantsIncrease = direction === "increase";

  const levers: GoalLever[] = [];
  for (const key of parameterKeys) {
    for (const d of deriveOutcomesForParameter(key, catalog)) {
      if (d.outcome !== outcome) continue;
      const parameterIncreasesOutcome = d.dir === "+";
      const recommendedMoveDirection: "up" | "down" =
        parameterIncreasesOutcome === userWantsIncrease ? "up" : "down";
      levers.push({ ...d, recommendedMoveDirection });
    }
  }

  levers.sort((a, b) => {
    const sd = STRENGTH_ORDER[b.strength] - STRENGTH_ORDER[a.strength];
    if (sd !== 0) return sd;
    if (a.parameterKey !== b.parameterKey) {
      return a.parameterKey.localeCompare(b.parameterKey);
    }
    return a.phase.localeCompare(b.phase);
  });
  return levers;
}

// ---------------------------------------------------------------------------
// Checker — refuses to let a broken catalog ship. Pure + synchronous so the
// proof test can exercise it without filesystem access.
// ---------------------------------------------------------------------------

export type CatalogIssue = {
  level: "error" | "warning";
  message: string;
};

/** Every entry must cite a KB file + section. */
export function findMissingCitations(
  catalog: readonly MechanismOutcomeEntry[] = MECHANISM_OUTCOME_CATALOG
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  catalog.forEach((e, i) => {
    const label = `entry ${i} (${e.mechanism} → ${e.outcome} @ ${e.phase})`;
    if (!e.kbSource || !e.kbSource.trim()) {
      issues.push({ level: "error", message: `${label} has no kbSource citation.` });
    }
    if (!e.kbSection || !e.kbSection.trim()) {
      issues.push({ level: "error", message: `${label} has no kbSection citation.` });
    }
  });
  return issues;
}

/**
 * Flags a mechanism+outcome+phase claimed in BOTH directions unless every entry
 * in that group is hedged (an explicit "it depends" is allowed; a silent
 * contradiction is not).
 */
export function findContradictions(
  catalog: readonly MechanismOutcomeEntry[] = MECHANISM_OUTCOME_CATALOG
): CatalogIssue[] {
  const groups = new Map<string, MechanismOutcomeEntry[]>();
  for (const e of catalog) {
    const key = `${e.mechanism}|${e.outcome}|${e.phase}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const issues: CatalogIssue[] = [];
  for (const [key, entries] of groups) {
    const dirs = new Set(entries.map((e) => e.dir));
    if (dirs.size > 1 && !entries.every((e) => e.hedge)) {
      issues.push({
        level: "error",
        message: `Contradiction at ${key}: claimed both "+" and "-" without hedging every entry. Fix the direction or set hedge:true on all of them.`,
      });
    }
  }
  return issues;
}

/** All blocking + advisory issues for a catalog. Empty = safe to ship. */
export function validateMechanismOutcomeCatalog(
  catalog: readonly MechanismOutcomeEntry[] = MECHANISM_OUTCOME_CATALOG
): CatalogIssue[] {
  return [...findMissingCitations(catalog), ...findContradictions(catalog)];
}

// ---------------------------------------------------------------------------
// Human-readable funnel output — used by the proof test so you can watch words
// turn into a sign-correct, cited recommendation.
// ---------------------------------------------------------------------------

const PHASE_LABEL: Record<CornerPhase, string> = {
  entry: "on entry",
  mid: "mid-corner",
  exit: "on exit",
  on_power: "on power",
  all: "throughout",
};

export function summarizeLevers(goalLabel: string, levers: readonly GoalLever[]): string[] {
  if (levers.length === 0) {
    return [`Goal "${goalLabel}": no catalogued levers yet (funnel returns nothing → prose fallback).`];
  }
  const lines = [`Goal "${goalLabel}":`];
  for (const l of levers) {
    const outcomeWords = l.outcome.replace(/_/g, " ");
    const hedge = l.hedge ? " (depends — keep the hedge)" : "";
    lines.push(
      `  • move ${l.parameterKey} ${l.recommendedMoveDirection} → ${outcomeWords} ${PHASE_LABEL[l.phase]} [${l.strength}]${hedge} — via ${l.mechanism}; cites ${l.kbSource}#${l.kbSection}`
    );
  }
  return lines;
}
