import { kbMechanismMappingsForKey } from "@/lib/engineerPhase5/kbSetupKeyPhysics";

/**
 * Setup-key → mechanism mapping informed by `content/vehicle-dynamics/*.md`.
 *
 * The Engineer uses this so historical analogies aren't limited to identical keys.
 * Example: "Last time you raised rear inner-lower it added rear support. The option
 * you're considering raises the rear ARB stiffness, which **also adds rear support**,
 * even though it's a different key." Confidence tiers:
 *
 *   - Exact key + direction match: high.
 *   - Same family (same mechanism, same direction): medium.
 *   - Mechanism-only analogy (different family, overlapping effect): low.
 *
 * Mappings here are deliberately conservative; the KB still has to be the source of
 * truth for nuance. The Engineer always explains the analogy rather than just acting
 * on it.
 */

export type SetupMechanismId =
  | "front_rc_lower_arm"
  | "rear_rc_lower_arm"
  | "front_rc_upper_link"
  | "rear_rc_upper_link"
  | "front_anti_dive"
  | "rear_anti_squat"
  | "front_support"
  | "rear_support"
  | "front_spring_rate"
  | "rear_spring_rate"
  | "front_arb"
  | "rear_arb"
  | "front_damper_oil"
  | "rear_damper_oil"
  | "diff_oil"
  | "front_toe"
  | "rear_toe"
  | "front_camber"
  | "rear_camber"
  | "front_bump_steer"
  | "rear_toe_gain"
  | "front_caster"
  | "weight_balance";

export type SetupMechanismDirection = "raises" | "lowers" | "stiffens" | "softens" | "more" | "less";

export type SetupMechanismMapping = {
  mechanism: SetupMechanismId;
  /** What the mechanism increases/decreases when the key's numeric value goes UP. */
  whenIncreasedEffect: SetupMechanismDirection;
};

export type SetupMechanismLabelMap = Record<SetupMechanismId, string>;

export const SETUP_MECHANISM_LABELS: SetupMechanismLabelMap = {
  front_rc_lower_arm: "front roll centre (lower-arm)",
  rear_rc_lower_arm: "rear roll centre (lower-arm)",
  front_rc_upper_link: "front roll centre (upper-link)",
  rear_rc_upper_link: "rear roll centre (upper-link)",
  front_anti_dive: "front anti-dive (FF−FR split)",
  rear_anti_squat: "rear anti-squat (RF−RR split)",
  front_support: "front geometric support",
  rear_support: "rear geometric support",
  front_spring_rate: "front spring rate",
  rear_spring_rate: "rear spring rate",
  front_arb: "front ARB",
  rear_arb: "rear ARB",
  front_damper_oil: "front damper oil",
  rear_damper_oil: "rear damper oil",
  diff_oil: "diff oil",
  front_toe: "front toe",
  rear_toe: "rear toe",
  front_camber: "front camber",
  rear_camber: "rear camber",
  front_bump_steer: "front bump steer",
  rear_toe_gain: "rear toe gain",
  front_caster: "front caster",
  weight_balance: "front/rear weight balance",
};

const KEY_MAP: Record<string, SetupMechanismMapping[]> = {
  // Under lower arm shims: raise lowers RC on that corner per support-lower-inner.md
  // Convention from KB: raising under_lower_arm_shims => raises RC AND adds support.
  under_lower_arm_shims_ff: [
    { mechanism: "front_rc_lower_arm", whenIncreasedEffect: "raises" },
    { mechanism: "front_support", whenIncreasedEffect: "more" },
    { mechanism: "front_anti_dive", whenIncreasedEffect: "more" },
  ],
  under_lower_arm_shims_fr: [
    { mechanism: "front_rc_lower_arm", whenIncreasedEffect: "raises" },
    { mechanism: "front_support", whenIncreasedEffect: "more" },
    { mechanism: "front_anti_dive", whenIncreasedEffect: "less" },
  ],
  under_lower_arm_shims_rf: [
    { mechanism: "rear_rc_lower_arm", whenIncreasedEffect: "raises" },
    { mechanism: "rear_support", whenIncreasedEffect: "more" },
    { mechanism: "rear_anti_squat", whenIncreasedEffect: "more" },
  ],
  under_lower_arm_shims_rr: [
    { mechanism: "rear_rc_lower_arm", whenIncreasedEffect: "raises" },
    { mechanism: "rear_support", whenIncreasedEffect: "more" },
    { mechanism: "rear_anti_squat", whenIncreasedEffect: "less" },
  ],
  // Upper inner shims: raising LOWERS RC on that corner (KB roll-centre.md).
  upper_inner_shims_ff: [
    { mechanism: "front_rc_upper_link", whenIncreasedEffect: "lowers" },
    { mechanism: "front_support", whenIncreasedEffect: "less" },
  ],
  upper_inner_shims_fr: [
    { mechanism: "front_rc_upper_link", whenIncreasedEffect: "lowers" },
    { mechanism: "front_support", whenIncreasedEffect: "less" },
  ],
  upper_inner_shims_rf: [
    { mechanism: "rear_rc_upper_link", whenIncreasedEffect: "lowers" },
    { mechanism: "rear_support", whenIncreasedEffect: "less" },
  ],
  upper_inner_shims_rr: [
    { mechanism: "rear_rc_upper_link", whenIncreasedEffect: "lowers" },
    { mechanism: "rear_support", whenIncreasedEffect: "less" },
  ],
  // Upper outer shims: raising RAISES RC (more angled link).
  upper_outer_shims_front: [
    { mechanism: "front_rc_upper_link", whenIncreasedEffect: "raises" },
  ],
  upper_outer_shims_rear: [
    { mechanism: "rear_rc_upper_link", whenIncreasedEffect: "raises" },
  ],
  // Springs
  front_spring_rate_gf_mm: [
    { mechanism: "front_spring_rate", whenIncreasedEffect: "stiffens" },
    { mechanism: "front_support", whenIncreasedEffect: "more" },
  ],
  rear_spring_rate_gf_mm: [
    { mechanism: "rear_spring_rate", whenIncreasedEffect: "stiffens" },
    { mechanism: "rear_support", whenIncreasedEffect: "more" },
  ],
  spring_front: [
    { mechanism: "front_spring_rate", whenIncreasedEffect: "stiffens" },
    { mechanism: "front_support", whenIncreasedEffect: "more" },
  ],
  spring_rear: [
    { mechanism: "rear_spring_rate", whenIncreasedEffect: "stiffens" },
    { mechanism: "rear_support", whenIncreasedEffect: "more" },
  ],
  // Damper oils
  shock_oil_front: [{ mechanism: "front_damper_oil", whenIncreasedEffect: "stiffens" }],
  shock_oil_rear: [{ mechanism: "rear_damper_oil", whenIncreasedEffect: "stiffens" }],
  damper_oil_front: [{ mechanism: "front_damper_oil", whenIncreasedEffect: "stiffens" }],
  damper_oil_rear: [{ mechanism: "rear_damper_oil", whenIncreasedEffect: "stiffens" }],
  // Diff
  diff_oil: [{ mechanism: "diff_oil", whenIncreasedEffect: "stiffens" }],
  diff: [{ mechanism: "diff_oil", whenIncreasedEffect: "stiffens" }],
  // Toe / camber
  toe_front: [{ mechanism: "front_toe", whenIncreasedEffect: "more" }],
  toe_rear: [{ mechanism: "rear_toe", whenIncreasedEffect: "more" }],
  camber_front: [{ mechanism: "front_camber", whenIncreasedEffect: "more" }],
  camber_rear: [{ mechanism: "rear_camber", whenIncreasedEffect: "more" }],
  // bump_steer_shims_front / toe_gain_shims_rear — resolved via kbSetupKeyPhysics in mechanismsForKey()
  // Hub under-stack
  under_hub_shims_front: [
    { mechanism: "front_rc_lower_arm", whenIncreasedEffect: "raises" },
    { mechanism: "front_support", whenIncreasedEffect: "more" },
  ],
  under_hub_shims_rear: [
    { mechanism: "rear_rc_lower_arm", whenIncreasedEffect: "raises" },
    { mechanism: "rear_support", whenIncreasedEffect: "more" },
  ],
  // Weight balance
  weight_balance_front_percent: [{ mechanism: "weight_balance", whenIncreasedEffect: "more" }],
};

/**
 * Returns the mechanism mappings for a key (empty when unknown). Engineers can
 * still use the key in advice without a mapping — mechanism mapping is supplemental.
 */
export function mechanismsForKey(key: string): SetupMechanismMapping[] {
  const kb = kbMechanismMappingsForKey(key);
  if (kb.length > 0) {
    return kb.map((m) => ({
      mechanism: m.mechanism,
      whenIncreasedEffect: m.whenIncreasedEffect,
    }));
  }
  return KEY_MAP[key] ?? [];
}

/**
 * Reverse: keys that participate in a given mechanism. Used to suggest analogies
 * across different keys ("not the same key but acts on the same mechanism").
 */
export function keysForMechanism(mechanism: SetupMechanismId): string[] {
  const out: string[] = [];
  for (const [key, mappings] of Object.entries(KEY_MAP)) {
    if (mappings.some((m) => m.mechanism === mechanism)) out.push(key);
  }
  return out;
}

export type SetupMechanismChangeDescriptor = {
  key: string;
  before: string;
  after: string;
};

export type SetupMechanismChangeReport = {
  key: string;
  before: string;
  after: string;
  numericDelta: number | null;
  perMechanism: Array<{
    mechanism: SetupMechanismId;
    label: string;
    effect: SetupMechanismDirection;
    /** Description like "added rear support" / "lowered front RC". */
    description: string;
    /** Sign of the move: +1 increased, -1 decreased, 0 unknown numeric direction. */
    sign: 1 | -1 | 0;
  }>;
};

function parseNumeric(value: string): number | null {
  const cleaned = value
    .replace(/mm|gf\/mm|cst|wt|%|°/gi, "")
    .replace(",", ".")
    .trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function applyDirectionForSign(effect: SetupMechanismDirection, sign: 1 | -1 | 0): SetupMechanismDirection {
  if (sign === 0) return effect;
  if (sign === 1) return effect;
  // sign === -1 — invert the direction.
  const inverse: Record<SetupMechanismDirection, SetupMechanismDirection> = {
    raises: "lowers",
    lowers: "raises",
    stiffens: "softens",
    softens: "stiffens",
    more: "less",
    less: "more",
  };
  return inverse[effect];
}

function describeEffect(label: string, effect: SetupMechanismDirection): string {
  switch (effect) {
    case "raises":
      return `raises ${label}`;
    case "lowers":
      return `lowers ${label}`;
    case "stiffens":
      return `stiffens ${label}`;
    case "softens":
      return `softens ${label}`;
    case "more":
      return `adds ${label}`;
    case "less":
      return `reduces ${label}`;
  }
}

export function describeMechanismChange(
  change: SetupMechanismChangeDescriptor
): SetupMechanismChangeReport {
  const mappings = mechanismsForKey(change.key);
  const numericBefore = parseNumeric(change.before);
  const numericAfter = parseNumeric(change.after);
  let sign: 1 | -1 | 0 = 0;
  let numericDelta: number | null = null;
  if (numericBefore != null && numericAfter != null && numericBefore !== numericAfter) {
    numericDelta = numericAfter - numericBefore;
    sign = numericDelta > 0 ? 1 : -1;
  }
  const perMechanism = mappings.map((m) => {
    const effect = applyDirectionForSign(m.whenIncreasedEffect, sign);
    return {
      mechanism: m.mechanism,
      label: SETUP_MECHANISM_LABELS[m.mechanism],
      effect,
      description: describeEffect(SETUP_MECHANISM_LABELS[m.mechanism], effect),
      sign,
    };
  });
  return {
    key: change.key,
    before: change.before,
    after: change.after,
    numericDelta,
    perMechanism,
  };
}

export type MechanismMatchTier = "exact_key_direction" | "same_family_same_direction" | "mechanism_analogy";

export type MechanismMatch = {
  tier: MechanismMatchTier;
  /** Specific shared mechanism (when applicable). */
  mechanism: SetupMechanismId | null;
  /** Effect direction the candidate change shares with the historical change. */
  effect: SetupMechanismDirection | null;
  reason: string;
};

/**
 * Compare a candidate proposed change to a historical change, returning the
 * strongest analogy tier. Returns null when the two changes do not share any
 * mechanism + direction (so the Engineer doesn't accidentally suggest unrelated history).
 */
export function matchProposedChangeToHistory(
  proposed: SetupMechanismChangeDescriptor,
  historical: SetupMechanismChangeDescriptor
): MechanismMatch | null {
  const proposedReport = describeMechanismChange(proposed);
  const historicalReport = describeMechanismChange(historical);

  if (proposed.key === historical.key && proposedReport.perMechanism.length > 0) {
    const sharedExact = proposedReport.perMechanism.find((p) =>
      historicalReport.perMechanism.some((h) => h.mechanism === p.mechanism && h.effect === p.effect)
    );
    if (sharedExact) {
      return {
        tier: "exact_key_direction",
        mechanism: sharedExact.mechanism,
        effect: sharedExact.effect,
        reason: `Same key and direction — historical change ${historicalReport.perMechanism[0]?.description ?? "unchanged"}.`,
      };
    }
  }

  for (const p of proposedReport.perMechanism) {
    for (const h of historicalReport.perMechanism) {
      if (p.mechanism === h.mechanism && p.effect === h.effect) {
        return {
          tier: proposed.key === historical.key ? "exact_key_direction" : "same_family_same_direction",
          mechanism: p.mechanism,
          effect: p.effect,
          reason: `Both moves ${p.description}. Different key${proposed.key === historical.key ? "" : "s"} but same mechanism + same direction.`,
        };
      }
    }
  }

  for (const p of proposedReport.perMechanism) {
    for (const h of historicalReport.perMechanism) {
      if (p.mechanism === h.mechanism) {
        return {
          tier: "mechanism_analogy",
          mechanism: p.mechanism,
          effect: p.effect,
          reason: `Both moves act on ${SETUP_MECHANISM_LABELS[p.mechanism]} — but in different directions. Reason about the analogy carefully.`,
        };
      }
    }
  }

  return null;
}
