import "server-only";

import { PARAMETER_EFFECT_CATALOG } from "./catalog";
import type {
  Effect,
  EffectStrength,
  Outcome,
  OutcomeDirection,
  ParameterEffectEntry,
  ParameterIntentMatch,
  ParameterIntentMatches,
  SpreadPositionBand,
} from "./types";

/**
 * Phase B query layer — resolves an outcome intent to a deterministic list of
 * catalogued parameters and joins each to the user's current value /
 * community median / positionBand.
 *
 * Pure (no server I/O) — relies only on the in-memory catalog. Safe to call
 * from any context-assembly path.
 */

const STRENGTH_ORDER: Record<EffectStrength, number> = {
  strong: 3,
  moderate: 2,
  weak: 1,
};

/** Raw catalog lookup, pre-join. Used internally and exported for tests. */
export function getParametersForIntent(
  outcome: Outcome,
  userDirection: OutcomeDirection
): Array<{ entry: ParameterEffectEntry; effect: Effect; recommendedMoveDirection: "up" | "down" }> {
  const userWantsIncrease = userDirection === "increase";
  const out: Array<{
    entry: ParameterEffectEntry;
    effect: Effect;
    recommendedMoveDirection: "up" | "down";
  }> = [];

  for (const entry of PARAMETER_EFFECT_CATALOG) {
    const effect = entry.effects[outcome];
    if (!effect) continue;
    const parameterIncreasesOutcome = effect.dir === "+";
    const recommendedMoveDirection: "up" | "down" =
      parameterIncreasesOutcome === userWantsIncrease ? "up" : "down";
    out.push({ entry, effect, recommendedMoveDirection });
  }

  out.sort((a, b) => {
    const sd = STRENGTH_ORDER[b.effect.strength] - STRENGTH_ORDER[a.effect.strength];
    if (sd !== 0) return sd;
    return a.entry.parameterKey.localeCompare(b.entry.parameterKey);
  });

  return out;
}

/**
 * Minimal structural shape we need from a setup-spread row for the join.
 * Intentionally narrower than `EngineerSetupSpreadRow` so this helper stays
 * decoupled from the server-only setupSpreadForEngineer module; the call site
 * can pass any compatible row shape.
 */
export type SpreadRowLike = {
  parameterKey: string;
  currentDisplay: string;
  spread: null | { median: number | null | undefined };
  positionBand: SpreadPositionBand;
};

/** Parse `currentDisplay` ("2.5", "3.0 mm", "-") to a number when possible. */
function parseCurrentDisplay(display: string): number | null {
  if (!display) return null;
  const trimmed = display.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "—") return null;
  // Accept a leading numeric prefix (e.g. "2.5 mm" → 2.5, "-1.5°" → -1.5).
  const match = trimmed.match(/^-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when the user's `positionBand` is already at/past the extreme end we'd
 * be pushing them toward. Conservative — only flags "above_typical" for an
 * "up" recommendation and "below_typical" for "down". In-range positions
 * (high/mid/low) do not flip the hedge.
 */
function computeHedgedAtPosition(
  recommendedMoveDirection: "up" | "down",
  positionBand: SpreadPositionBand | null
): boolean {
  if (!positionBand) return false;
  if (recommendedMoveDirection === "up" && positionBand === "above_typical") return true;
  if (recommendedMoveDirection === "down" && positionBand === "below_typical") return true;
  return false;
}

/**
 * Build the full structured output for an (outcome, direction) intent joined
 * with the user's setup-spread rows. Parameters missing from the spread (e.g.
 * user has no value for them) still appear in the list — `userCurrent`,
 * `communityMedian`, and `positionBand` are null in that case.
 *
 * `matchedPhrase` is passed through from the intent classifier for engineer
 * prompt transparency and debugging.
 */
export function buildParameterIntentMatches(params: {
  outcome: Outcome;
  direction: OutcomeDirection;
  matchedPhrase: string | null;
  spreadRows: readonly SpreadRowLike[];
}): ParameterIntentMatches {
  const { outcome, direction, matchedPhrase, spreadRows } = params;
  const rowByKey = new Map<string, SpreadRowLike>();
  for (const row of spreadRows) {
    if (row?.parameterKey) rowByKey.set(row.parameterKey, row);
  }

  const candidates = getParametersForIntent(outcome, direction);
  const matches: ParameterIntentMatch[] = candidates.map(
    ({ entry, effect, recommendedMoveDirection }) => {
      const row = rowByKey.get(entry.parameterKey) ?? null;
      const userCurrent = row ? parseCurrentDisplay(row.currentDisplay) : null;
      const medianRaw = row?.spread?.median;
      const communityMedian =
        typeof medianRaw === "number" && Number.isFinite(medianRaw) ? medianRaw : null;
      const positionBand = row?.positionBand ?? null;
      const hedgedDirectionAtPosition = computeHedgedAtPosition(
        recommendedMoveDirection,
        positionBand
      );
      return {
        parameterKey: entry.parameterKey,
        kbSource: entry.kbSource,
        kbSection: entry.kbSection,
        effect,
        recommendedMoveDirection,
        userCurrent,
        communityMedian,
        positionBand,
        hedgedDirectionAtPosition,
      };
    }
  );

  return {
    outcome,
    direction,
    matchedPhrase,
    matches,
  };
}
