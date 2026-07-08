/**
 * KB claim validator — pure structural invariants over a claim set
 * (ENGINEER_SUGGESTION_QUALITY_PLAN.md 2a). Not gated; iterate freely.
 *
 * Enforces the schema promises that keep the ID layer trustworthy as the moat's spine:
 * ids stable + unique + well-formed, retirements form a valid chain (no dangling/cyclic
 * supersession — else notebook history orphans), predictability/evidence/claimClass are
 * coherent, and `situational` claims actually state their conditions. FILE-existence and
 * prose-traceability checks are intentionally NOT here (they need fs / the KB); a
 * script-level check mirrors the parameterEffects catalog validator for that.
 */

import { CLAIM_ID_PATTERN, type KbClaim } from "./types";

export type ClaimValidationIssue = {
  claimId: string;
  problem: string;
};

const PREDICTABILITY = new Set(["reliable", "usual", "situational", "experimental"]);
const EVIDENCE = new Set([
  "physics_derivation",
  "expert_testimony",
  "community_data",
  "this_driver_outcome",
  "derived_from_approved_prose",
]);
const CLAIM_CLASS = new Set(["physics_mechanism", "this_driver_empirical", "procedural_craft"]);

export function validateKbClaims(claims: readonly KbClaim[]): ClaimValidationIssue[] {
  const issues: ClaimValidationIssue[] = [];
  const push = (claimId: string, problem: string) => issues.push({ claimId, problem });

  const ids = new Set<string>();
  for (const c of claims) {
    // Stable-id hygiene.
    if (!CLAIM_ID_PATTERN.test(c.id)) push(c.id, "malformed id (expected vdk-NNNN)");
    if (ids.has(c.id)) push(c.id, "duplicate id — ids are assigned once and never reused");
    ids.add(c.id);

    // Enum coherence.
    if (!PREDICTABILITY.has(c.predictability)) push(c.id, `bad predictability "${c.predictability}"`);
    if (!EVIDENCE.has(c.evidence)) push(c.id, `bad evidence tier "${c.evidence}"`);
    if (!CLAIM_CLASS.has(c.claimClass)) push(c.id, `bad claimClass "${c.claimClass}"`);

    // Anchor + statement present.
    if (!c.kbSource.trim()) push(c.id, "missing kbSource");
    if (!c.kbSection.trim()) push(c.id, "missing kbSection anchor");
    if (!c.statement.trim()) push(c.id, "empty statement");

    // situational claims must say WHEN they change (the whole point of the tier).
    if (c.predictability === "situational" && !c.conditions?.trim()) {
      push(c.id, "situational predictability requires machine-readable `conditions`");
    }

    // A physics/mechanism claim cannot be sourced from a single driver's outcome.
    if (c.claimClass === "physics_mechanism" && c.evidence === "this_driver_outcome") {
      push(c.id, "physics_mechanism claim cannot have evidence=this_driver_outcome");
    }

    // Retirement chain hygiene: supersededBy must exist and not point at itself.
    if (c.supersededBy) {
      if (c.supersededBy === c.id) push(c.id, "supersededBy points at itself");
      else if (!claims.some((o) => o.id === c.supersededBy)) {
        push(c.id, `supersededBy "${c.supersededBy}" references an unknown claim`);
      }
      if (!c.retired) push(c.id, "has supersededBy but is not marked retired");
    }
  }

  // No supersession cycles (A→B→A would orphan lifecycle links in a loop).
  const successor = new Map(claims.filter((c) => c.supersededBy).map((c) => [c.id, c.supersededBy!]));
  for (const start of successor.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur && successor.has(cur)) {
      if (seen.has(cur)) {
        push(start, "supersession cycle detected");
        break;
      }
      seen.add(cur);
      cur = successor.get(cur);
    }
  }

  return issues;
}

/** Convenience: true when the claim set has no structural problems. */
export function kbClaimsAreValid(claims: readonly KbClaim[]): boolean {
  return validateKbClaims(claims).length === 0;
}
