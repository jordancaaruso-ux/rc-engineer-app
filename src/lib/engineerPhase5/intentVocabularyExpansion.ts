import "server-only";

/**
 * PHASE A BANDAID — narrowed automatically when Phase B returns catalog matches.
 * `buildEngineerRichContextV1` uses the raw user message for KB search when
 * `parameterIntentMatches.matches.length > 0` (see `kbSearchQueryForMessage` in
 * `engineerRichContext.ts`). Otherwise this expansion still runs. See ARCHITECTURE
 * note at the bottom of this file.
 *
 * The vehicle-dynamics KB retriever (`searchVehicleDynamicsKb`) is a plain
 * bag-of-words scorer: each `##` section is scored by how many unique query
 * tokens appear in it (binary .includes, no weighting). A user question like
 * "how can I get more rear grip" only contributes ~3 matching tokens against
 * any rear-relevant chunk, which lets unrelated chunks tie or win by directory
 * order and drops obviously-relevant parameters (e.g. rear toe) out of the
 * top-K.
 *
 * This helper expands the raw user message with parameter vocabulary whenever
 * the phrasing implies a setup-tuning intent, so that canonical parameter keys
 * (`toe_rear`, `camber_rear`, `spring_rear`, ...) that appear in the KB markdown
 * bodies get counted toward the score. It does NOT change retrieval semantics
 * for non-setup questions.
 *
 * Design rules:
 *  - Never remove tokens from the original message; only append.
 *  - Prefer appending canonical parameter keys (e.g. `toe_rear`) over prose,
 *    because KB chunks cite the keys verbatim in `**Key:** \`...\`` lines.
 *  - Fallback to a combined both-ends vocab only when a setup-intent marker is
 *    present but no directional marker is.
 */

/** Phrases that make us pretty sure the user is talking about the REAR of the car. */
const REAR_HINTS = [
  "rear",
  "back end",
  "on power",
  "on-power",
  "on throttle",
  "exit",
  "exits",
  "squirm",
  "loose",
  "drive off",
  "off corner",
  "off the corner",
];

/** Phrases that make us pretty sure the user is talking about the FRONT of the car. */
const FRONT_HINTS = [
  "front",
  "understeer",
  "push",
  "pushes",
  "turn in",
  "turn-in",
  "entry",
  "initial bite",
  "initial grip",
  "initial steering",
];

/** Track / surface roughness intent — biases toward damper / spring / flex chunks. */
const BUMPS_HINTS = [
  "bump",
  "bumps",
  "bumpy",
  "kerb",
  "kerbs",
  "curb",
  "curbs",
  "rough surface",
  "rough track",
];

/** Generic setup-tuning intent markers (used as a fallback to decide whether to expand at all). */
const SETUP_INTENT_HINTS = [
  "grip",
  "traction",
  "rotation",
  "rotate",
  "steering",
  "balance",
  "handling",
  "setup",
  "tune",
  "trim",
  "stability",
  "oversteer",
  "understeer",
  "bite",
  "feel",
  "corner speed",
  "mid corner",
  "mid-corner",
];

/**
 * Canonical rear parameter keys + prose tokens likely to appear in rear-focused KB sections.
 * Exported as an array so `vehicleDynamicsKb.ts` can run a guaranteed-coverage pass for any
 * canonical key the user's expanded query named.
 */
export const REAR_PARAM_VOCAB_KEYS: readonly string[] = [
  "rear",
  "toe_rear",
  "camber_rear",
  "spring_rear",
  "rear_spring_rate_gf_mm",
  "damper_oil_rear",
  "arb_rear",
  "caster_rear",
  "toe_gain_shims_rear",
  "upper_inner_shims_rf",
  "upper_inner_shims_rr",
  "upper_outer_shims_rear",
  "under_lower_arm_shims_rf",
  "under_lower_arm_shims_rr",
  "under_hub_shims_rear",
  "droop_rear",
  "downstop_rear",
  "toe gain",
  "rear toe",
  "rear camber",
  "rear spring",
  "rear damper",
  "rear arb",
  "rear caster",
  "roll centre",
  "upper inner",
  "under lower arm",
  "bump steer",
  "diff oil",
];
const REAR_PARAM_VOCAB = REAR_PARAM_VOCAB_KEYS.join(" ");

/**
 * Canonical front parameter keys + prose tokens likely to appear in front-focused KB sections.
 * Exported as an array so `vehicleDynamicsKb.ts` can run a guaranteed-coverage pass.
 */
export const FRONT_PARAM_VOCAB_KEYS: readonly string[] = [
  "front",
  "toe_front",
  "camber_front",
  "spring_front",
  "front_spring_rate_gf_mm",
  "damper_oil_front",
  "arb_front",
  "caster_front",
  "bump_steer_shims_front",
  "upper_inner_shims_ff",
  "upper_inner_shims_fr",
  "upper_outer_shims_front",
  "under_lower_arm_shims_ff",
  "under_lower_arm_shims_fr",
  "under_hub_shims_front",
  "droop_front",
  "downstop_front",
  "front toe",
  "front camber",
  "front spring",
  "front damper",
  "front arb",
  "front caster",
  "roll centre",
  "upper inner",
  "under lower arm",
  "bump steer",
];
const FRONT_PARAM_VOCAB = FRONT_PARAM_VOCAB_KEYS.join(" ");

/** Vocabulary that highlights damper / spring / flex chunks for bumps-related questions. */
const BUMPS_VOCAB = [
  "damper oil",
  "damper_oil_front",
  "damper_oil_rear",
  "spring",
  "flex",
  "chassis",
  "roll centre",
  "bumps",
  "compliant",
  "compliance",
].join(" ");

/** Fallback when user clearly wants setup advice but didn't specify front/rear/bumps. */
const BOTH_ENDS_VOCAB = [
  REAR_PARAM_VOCAB,
  FRONT_PARAM_VOCAB,
  "spring",
  "damper oil",
  "arb",
  "camber",
  "caster",
  "toe",
  "roll centre",
  "upper inner",
  "under lower arm",
  "bump steer",
].join(" ");

function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true;
  }
  return false;
}

/**
 * Append canonical parameter vocabulary to a free-text Engineer user message when
 * the phrasing implies a setup-tuning intent. Returns the message unchanged when
 * no setup intent is detected.
 */
export function expandEngineerUserMessageForKbSearch(message: string): string {
  if (!message || typeof message !== "string") return message ?? "";
  const lower = message.toLowerCase();

  const hasRear = containsAny(lower, REAR_HINTS);
  const hasFront = containsAny(lower, FRONT_HINTS);
  const hasBumps = containsAny(lower, BUMPS_HINTS);
  const hasGeneric = containsAny(lower, SETUP_INTENT_HINTS);

  if (!hasRear && !hasFront && !hasBumps && !hasGeneric) {
    return message;
  }

  const parts: string[] = [message];
  if (hasRear) parts.push(REAR_PARAM_VOCAB);
  if (hasFront) parts.push(FRONT_PARAM_VOCAB);
  if (hasBumps) parts.push(BUMPS_VOCAB);
  if (!hasRear && !hasFront && !hasBumps && hasGeneric) {
    parts.push(BOTH_ENDS_VOCAB);
  }

  return parts.join(" ");
}

/*
 * ARCHITECTURE NOTE — Phase B (live):
 * The parameter-effect catalog (`parameterEffects/catalog.ts`, KB-gated) plus
 * `buildParameterIntentMatches` supplies deterministic ordering when populated.
 * This expansion remains the fallback when the catalog is empty or no intent
 * matches. Delete this helper only when retrieval no longer needs the extra
 * tokens for any supported flow.
 */
