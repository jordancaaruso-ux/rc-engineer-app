import "server-only";

import type { ParameterEffectEntry } from "./types";

/**
 * AUTHORED CONTENT — treat as if it lived under `content/vehicle-dynamics/`.
 *
 * Every entry in this catalog becomes ground-truth input to the Engineer's
 * structured reasoning about parameter → outcome mappings. Adding or editing
 * an entry has the same end-user impact as editing a KB markdown file: the
 * Engineer will quote the `kbSource` + `kbSection` citation verbatim and rank
 * the parameter against alternatives based on `strength` and `hedge`.
 *
 * Rules for maintaining this file (enforced by `.cursor/rules/` and `AGENTS.md`):
 *
 *   1. DO NOT add, remove, or modify any entry in `PARAMETER_EFFECT_CATALOG`
 *      without explicit user approval in the triggering chat message.
 *   2. Every entry's `kbSource` MUST point to a real file under
 *      `content/vehicle-dynamics/`, and `kbSection` MUST match an existing
 *      `## Heading` in that file (slugified, lowercase, spaces → "-").
 *   3. Every `effects.<outcome>` direction, hedge flag, and strength MUST be
 *      derivable from the KB prose at that anchor — do not infer from general
 *      racing knowledge or from this repo's prior agent-authored commentary.
 *   4. Propose new entries in chat with the matching KB quote first; only
 *      write to this file after the user types explicit approval.
 *   5. When the KB prose is edited, re-verify every entry that cites that file
 *      and propose catalog updates in the same change if any direction / hedge
 *      flag shifted.
 *
 * The catalog is read once at module load; consumers must treat the array as
 * immutable. To test the Engineer without populating the catalog, leave it
 * empty — the rich context code will fall through to the keyword-retrieval
 * path unchanged.
 */
export const PARAMETER_EFFECT_CATALOG: readonly ParameterEffectEntry[] = [
  // Entries are authored one KB file at a time, each gated on explicit user
  // approval. Start empty so Phase B infrastructure can ship dormant.
];
