/**
 * KB claim-ID schema — ENGINEER_SUGGESTION_QUALITY_PLAN.md, step 2a / first concrete
 * artifact (b): "the prose KB must be atomized into enumerated claim units with stable
 * IDs, each carrying predictability, provenance, and conditions."
 *
 * WHY IDs, not prose locations (plan §"Claims are addressable units"):
 * - The verify pass needs "must trace to a claim ID" so physics can't be costumed as craft.
 * - The confidence cap reads predictability + evidence tier PER CLAIM.
 * - The suggestion lifecycle records which claim IDs each suggestion relied on FROM DAY
 *   ONE — retroactive linking won't work, so the ID must be stable and exist before any
 *   graph does. That is why the ID is a synthetic opaque key, decoupled from the heading
 *   text: rewording a `## Heading` (which changes kbSection) must NOT orphan notebook
 *   history or mined clusters. Location (kbSource/kbSection) is mutable metadata; `id` is
 *   assigned once and never reused or repurposed.
 *
 * This is SCHEMA + machine only. Populating it — atomizing approved prose into claims and
 * asserting each claim's predictability/evidence — is KB content and is FOUNDER-GATED per
 * AGENTS.md (propose in chat, quote the supporting prose line). The registry ships empty.
 */

// Type-only imports are erased at runtime, so pulling these from the server-only
// parameterEffects/types module does NOT trigger its `import "server-only"` side effect —
// keeps this module importable from the tsx test runner. Same trick as mechanismOutcomes.ts.
import type { EffectDirection, EffectStrength, Outcome } from "@/lib/engineerPhase5/parameterEffects/types";
import type { CornerPhase } from "@/lib/engineerPhase5/parameterEffects/mechanismOutcomes";

/** Opaque, stable, assigned-once claim key. Pattern: `vdk-<zero-padded-ordinal>` (vdk = vehicle-dynamics KB). */
export type ClaimId = string;

/** Regex a well-formed ClaimId must match. Sequential ordinal, never content-derived. */
export const CLAIM_ID_PATTERN = /^vdk-\d{4,}$/;

/**
 * How reliably the effect appears AT ALL — separate from strength (typical magnitude),
 * per the north star ("what should happen based on good info sometimes doesn't"). Drives
 * confidence-ladder wording and the promote-testing stance.
 */
export type PredictabilityTier =
  | "reliable" // shows up essentially always
  | "usual" // shows up in most conditions
  | "situational" // depends on surface/grip/tyre/phase — carries machine-readable `conditions`
  | "experimental"; // theory says so; test it. Maps to "theory — test it" wording.

/**
 * Evidence tier — provenance recorded at authoring, worded (never source-named) at runtime
 * ("settled physics" / "well-documented among top drivers" / "community data suggests" /
 * "your own runs showed"). `derived_from_approved_prose` marks a structured claim reusing
 * the sunk approval of a prose file (founder spot-checks rather than re-authors).
 */
export type EvidenceTier =
  | "physics_derivation"
  | "expert_testimony"
  | "community_data"
  | "this_driver_outcome"
  | "derived_from_approved_prose";

/**
 * Verify-pass claim class (plan §"Claim classes for the verify pass"). The verify pass
 * classifies claims INDEPENDENTLY of the author-model's label (anti-gaming) — this field
 * records the authored intent, not a runtime trust signal.
 */
export type ClaimClass =
  | "physics_mechanism" // must trace to a claim ID / graph edge
  | "this_driver_empirical" // must trace to the notebook
  | "procedural_craft"; // tyre prep, line, "no change — verify"; hedged, never stated as mechanism

/** Which KB tier the claim currently lives in — mirrors the two-tier KB (AGENTS.md). */
export type ClaimKbTier = "approved" | "draft";

/**
 * One atomized KB claim. Finer-grained than a `##` section: roughly one bolded sub-block
 * (Mechanics / Corner phases / Balance, or Physics / Handling), often a single sentence
 * carrying {parameter, direction, outcome, hedge, condition}.
 */
export type KbClaim = {
  /** Stable, assigned once, never reused (see CLAIM_ID_PATTERN). */
  id: ClaimId;
  /** Current file under content/vehicle-dynamics/ (or drafts/). MUTABLE metadata. */
  kbSource: string;
  /** Current slugified `## Heading` anchor. MUTABLE metadata — id does not change with it. */
  kbSection: string;
  kbTier: ClaimKbTier;
  claimClass: ClaimClass;
  predictability: PredictabilityTier;
  evidence: EvidenceTier;
  /** The atomized statement, quoted from / faithfully derived from the prose at the anchor. */
  statement: string;
  /** Machine-ish note on WHEN the effect changes — required in spirit for `situational`. */
  conditions?: string;
  /** Canonical setup key when the claim is a parameter-level edge, e.g. "toe_rear". */
  parameterKey?: string;
  /** Structured effect when the claim is a param/mechanism → outcome edge (reuses shared vocab). */
  effect?: {
    outcome: Outcome;
    phase: CornerPhase;
    /** Outcome direction when the parameter/mechanism *increases*. */
    dir: EffectDirection;
    strength: EffectStrength;
  };
  /** Revisions RETIRE, never delete — keeps notebook/lifecycle links to old IDs valid. */
  retired?: boolean;
  /** When retired in favour of a rewrite, the successor claim's id (must exist, no cycle). */
  supersededBy?: ClaimId;
};

/** Runtime citation string for a claim — `file#section (id)`. Source names never surface. */
export function claimCiteString(claim: Pick<KbClaim, "kbSource" | "kbSection" | "id">): string {
  return `${claim.kbSource}#${claim.kbSection} (${claim.id})`;
}
