import "server-only";

/**
 * Phase B — structured parameter-effect index (types only).
 *
 * These types are the contract between:
 *   - authored catalog entries in `./catalog.ts` (under KB lockdown)
 *   - the intent classifier in `./intentFromMessage.ts`
 *   - the query + join helpers in `./query.ts`
 *   - the engineer rich context + system prompt (wiring lives elsewhere; this
 *     module stays dormant until the catalog is populated and rich context
 *     is updated to read it).
 *
 * Design goals:
 *   - Deterministic: same (outcome, direction) → same ordered parameter list.
 *   - Closed vocabulary: `Outcome` is a small union so catalog entries fail at
 *     compile time when they reference an unknown outcome.
 *   - No silent ambiguity: every entry must name its source KB file + section.
 */

/**
 * The closed set of driver-facing outcomes the Engineer can reason about as a
 * goal (e.g. "more rear grip"). Extend this union deliberately — every addition
 * is a new column every catalog entry may need.
 *
 * Keep this list tight. If the user asks about an outcome outside this set the
 * engineer falls back to prose retrieval (the existing KB search), not the
 * structured lookup.
 */
export type Outcome =
  | "rear_grip"
  | "front_grip"
  | "rear_rotation"
  | "front_rotation"
  | "on_power_stability"
  | "corner_speed"
  | "initial_bite"
  | "compliance_over_bumps";

/** Which way the user wants the outcome to move. */
export type OutcomeDirection = "increase" | "decrease";

/**
 * How a parameter affects an outcome.
 *   "+" = increasing the parameter (more / thicker / stiffer / raised) increases the outcome.
 *   "-" = increasing the parameter decreases the outcome (i.e. to get more of the outcome, go the other way).
 *
 * Parameters whose sign convention varies by sheet (e.g. toe sign flips on some
 * cars) should still be catalogued in the canonical convention documented in
 * the KB file, and the engineer relies on existing sign-normalisation upstream.
 */
export type EffectDirection = "+" | "-";

/** Relative strength of the effect. Used to rank recommendations. */
export type EffectStrength = "weak" | "moderate" | "strong";

/** A single effect entry: "this parameter pushes this outcome this way". */
export type Effect = {
  dir: EffectDirection;
  /**
   * True when the KB hedges the effect ("can sometimes", "depending on balance",
   * "not always predictable", paired opposite outcomes). The engineer must
   * preserve hedges in the reply when this flag is set.
   */
  hedge: boolean;
  strength: EffectStrength;
  /** Optional authored caveat — short prose. Surfaces into the engineer context. */
  notes?: string;
};

/**
 * One catalogued parameter: its canonical key, the KB prose it derives from,
 * and all the outcomes it affects.
 *
 * `parameterKey` MUST match the `parameterKey` used on `EngineerSetupSpreadRow`
 * (see `setupSpreadForEngineer.ts`) so the join in `query.ts` lines up the
 * user's current value and `positionBand`.
 */
export type ParameterEffectEntry = {
  /** Canonical setup parameter key (e.g. "toe_rear"). */
  parameterKey: string;
  /**
   * KB filename the entry was derived from, relative to `content/vehicle-dynamics/`
   * (e.g. "camber-caster-toe.md"). Surfaces into the engineer reply as a citation.
   */
  kbSource: string;
  /** Anchor in the KB file (e.g. "#rear-toe"). The engineer cites `${kbSource}${kbSection}`. */
  kbSection: string;
  /**
   * All outcomes this parameter affects. Partial map — omit outcomes the KB
   * doesn't explicitly cover for this parameter; do not guess.
   */
  effects: Partial<Record<Outcome, Effect>>;
  /** Optional top-level authored note for the whole parameter. */
  notes?: string;
};

/**
 * Spread `positionBand` values mirrored from `setupSpreadForEngineer.SetupSpreadPositionBand`.
 * Duplicated here to keep `parameterEffects/` free of cross-module imports at
 * the type-definition layer. The join helper asserts structural compatibility
 * at the call site.
 */
export type SpreadPositionBand =
  | "below_typical"
  | "low"
  | "mid"
  | "high"
  | "above_typical"
  | "not_numeric"
  | "no_spread_data";

/**
 * A catalog entry joined with the user's current value, community median, and
 * positionBand for a single outcome+direction intent. This is what gets handed
 * to the Engineer in rich context.
 */
export type ParameterIntentMatch = {
  parameterKey: string;
  kbSource: string;
  kbSection: string;
  effect: Effect;
  /**
   * To move the outcome in the user's requested direction, move this parameter
   * this way. Derived from `effect.dir` and the requested `OutcomeDirection`.
   */
  recommendedMoveDirection: "up" | "down";
  /** Parsed from the setup-spread row's currentDisplay; null when non-numeric or blank. */
  userCurrent: number | null;
  /** Community median when available. */
  communityMedian: number | null;
  /** Raw positionBand echoed from the spread row. */
  positionBand: SpreadPositionBand | null;
  /**
   * True when the user is already past the beneficial end for the recommended
   * move direction: e.g. recommendedMoveDirection="up" and positionBand="above_typical",
   * OR recommendedMoveDirection="down" and positionBand="below_typical".
   * The engineer must deprioritise or flip to downside language for these.
   */
  hedgedDirectionAtPosition: boolean;
};

/** The full structured output for a detected outcome intent. */
export type ParameterIntentMatches = {
  outcome: Outcome;
  direction: OutcomeDirection;
  /** The user phrase that triggered this intent; surfaces for prompt transparency and debugging. */
  matchedPhrase: string | null;
  /** Catalog matches joined with user context; ordered by `effect.strength` then `parameterKey`. */
  matches: ParameterIntentMatch[];
};
