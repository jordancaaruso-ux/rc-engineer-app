---
description: The Engineer KB is quoted to drivers as ground truth — do not edit without typed approval
paths:
  - "content/vehicle-dynamics/**"
  - "src/lib/engineerPhase5/parameterEffects/catalog.ts"
---

# Engineer KB protection

The Engineer retrieves `content/vehicle-dynamics/*.md` verbatim (`searchVehicleDynamicsKb` in
`src/lib/engineerPhase5/vehicleDynamicsKb.ts`) and quotes it back to drivers as authoritative RC
setup advice. Any language written here is presented to end users as expert knowledge, whoever
wrote it. `src/lib/engineerPhase5/parameterEffects/catalog.ts` is an extension of this KB — every
entry is quoted as ground truth, so the same gate applies.

## Hard rules

1. **Do not modify** any file under `content/vehicle-dynamics/` (top level) or the entries in
   `catalog.ts` unless the user's **most recent message** explicitly names the file or explicitly
   asks for KB content edits. "Improving clarity", "tightening grammar", "adding a missing
   concept" are NOT sufficient.
2. **If a KB edit is genuinely required**, propose the exact paragraphs (or catalog entries) in
   chat as a single-file diff, and wait for the user to type explicit approval before writing.
3. **For Engineer *behaviour* changes, the fix usually isn't in the KB.** Try first:
   `openaiEngineer.ts` (system prompt), `engineerRichContext.ts` (what data the Engineer sees),
   `vehicleDynamicsKb.ts` (retrieval). Surrounding code (`types.ts`, `intentFromMessage.ts`,
   `query.ts`) is normal — edit freely; only `catalog.ts` entries are locked.
4. **Catalog entries must trace back to KB prose.** Every `effects.<outcome>` direction, hedge
   flag, and strength must be derivable from the matching KB file + `kbSection` anchor. Never
   infer directions from general racing knowledge. Quote the supporting KB line when proposing one.

## Drafts (open tier)

`content/vehicle-dynamics/drafts/*.md` are agent-writable (founder-granted 2026-07-07). Rules:
provenance banner at top; never contradict or duplicate the approved tier (flag conflicts in
chat); terse physics-first style — `##` sections, `**Keys:**` lines, a `**Physics.**` block then
`**Handling.**` block; no coaching, no invented numbers; ≤ ~90 lines; preserve `##` heading levels
(that's what retrieval splits on). Only Jordan promotes a draft to the approved tier.

## Style (approved edits only)

Match the terse, bold-for-technical-terms prose. Forbidden metaphors unless the user dictated
them: **breathe, platforms, dances, comes alive, settles, marries, talks to, listens, wants,
feels like**. Use "tends to", "often", "typically" instead.
