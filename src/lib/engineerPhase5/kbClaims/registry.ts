/**
 * KB claim registry — the atomized-claim store (ENGINEER_SUGGESTION_QUALITY_PLAN.md 2a).
 *
 * SHIPS EMPTY on purpose, exactly like PARAMETER_EFFECT_CATALOG and
 * MECHANISM_OUTCOME_CATALOG: the infrastructure lands dormant so downstream consumers
 * (verify pass, confidence cap, suggestion-lifecycle claim-id capture) can be built and
 * tested against a real schema, while the CONTENT — atomizing approved prose into claims —
 * is authored one file at a time under the AGENTS.md founder gate.
 *
 * AUTHORING IS HUMAN-GATED:
 *   1. Do NOT add/edit/remove a KB_CLAIMS entry without explicit user approval in the
 *      triggering chat message (same rule as content/vehicle-dynamics/).
 *   2. Every claim's `predictability`, `evidence`, `effect`, and `statement` MUST trace to
 *      prose at the cited `kbSource` + `kbSection` — quote the line in the proposal.
 *   3. IDs are allocated with `nextClaimId` and NEVER reused; revisions set `retired` +
 *      `supersededBy`, they do not delete or repurpose an id.
 *
 * The validator (validate.ts) and proof test are the free machine around this data.
 */

import { CLAIM_ID_PATTERN, type ClaimId, type KbClaim } from "./types";

/** AUTHORED CONTENT — human-gated (see file header). Ships empty. */
export const KB_CLAIMS: readonly KbClaim[] = [
  // Authored one KB file at a time, each gated on explicit user approval.
];

/** Highest ordinal currently allocated (0 when empty), scanning retired ids too. */
function highestOrdinal(claims: readonly KbClaim[]): number {
  let max = 0;
  for (const c of claims) {
    const m = /^vdk-(\d+)$/.exec(c.id);
    if (m) max = Math.max(max, Number(m[1]));
    // Superseded ids may not appear as entries; count them so we never reuse one.
    if (c.supersededBy) {
      const sm = /^vdk-(\d+)$/.exec(c.supersededBy);
      if (sm) max = Math.max(max, Number(sm[1]));
    }
  }
  return max;
}

/**
 * Allocate the next stable claim id. Monotonic, zero-padded to 4 digits, never reuses a
 * retired/superseded ordinal. Pass the full existing set (including retired) so ids stay unique.
 */
export function nextClaimId(existing: readonly KbClaim[] = KB_CLAIMS): ClaimId {
  const next = highestOrdinal(existing) + 1;
  return `vdk-${String(next).padStart(4, "0")}`;
}

/** Active (non-retired) claims. */
export function activeClaims(claims: readonly KbClaim[] = KB_CLAIMS): KbClaim[] {
  return claims.filter((c) => !c.retired);
}

/** Look up a claim by id (including retired ones — lifecycle rows may cite a retired id). */
export function claimById(id: ClaimId, claims: readonly KbClaim[] = KB_CLAIMS): KbClaim | null {
  return claims.find((c) => c.id === id) ?? null;
}

/** True if the id is well-formed (assigned by nextClaimId), independent of the registry. */
export function isWellFormedClaimId(id: string): boolean {
  return CLAIM_ID_PATTERN.test(id);
}
