---
name: audit-kb
description: Rules for auditing or editing the vehicle-dynamics knowledge base in content/vehicle-dynamics. Load whenever the KB, its files, a proposed KB edit, or whether an Engineer answer was correct is discussed. Triggers include "audit the kb", "review the kb", "engineer got this wrong", "add this to the kb".
---

# Auditing the KB

Every rule below came from a correction Jordan made. None are predicted.

**The rule.** Every sentence states something physics forces. Not usually true, not true in
Jordan's experience — forced.

**The KB holds premises. The Engineer composes.** A page says what a part does and stops.

**A bad answer is a KB defect** — wrong, unclear, or incomplete. Never fix it with a prompt rule.

## What doesn't belong

1. **A net** — a car outcome built from one axle. "frees the rear", "lets it yaw", "on balance".
2. **An unforced claim** — a ratio, frequency or magnitude the mechanism doesn't give. "mostly
   timing" where it only supports "more of".
3. **Seat time** — Jordan's experience as fact. When it disagrees with the KB that is a missing
   mechanism to find, not a sentence to paste.
4. **An instruction to the Engineer** — "say which part you answered for". Prompt, or nowhere.
5. **The KB about itself** — guard sentences, commentary on its own rules.
6. **An unruled word** — feel vocabulary outside the closed list in `concepts/bite-hold.md`.
7. **A second home** — a claim on two pages. One home; everything else links. Near-duplicate
   prose across files is the only check a script can do.

8. **An unresolvable condition** — a split the driver's own words can't answer. Conditions are
   written in the phase vocabulary (`concepts/bite-hold.md`, "Phase" line); symptom words
   ("pushes", "loose") are car outcomes and never appear — their translation lives in the prompt.

## How to audit

Read it. One question per claim: **what forces this?**

Mark every claim — where it came from (`founder-confirmed <date>`, `solver-verified`,
`unverified`) and how far it reaches (`not derivable from X alone`). Unmarked means unruled.
Pages are never finished.

**Propose removals. Surface gaps.** Deletions and restructuring are mine. Physics Jordan has not
ruled on is his.

## Process

Fluent prose pulls toward more than the physics gives. These move the catching from Jordan to me:

- **Audit before he reads.** No KB prose reaches Jordan until every sentence has passed "what
  forces this?" — flag what I couldn't force rather than let him find it.
- **One page or claim per exchange.** He rules, then build on ruled ground. Multi-part proposals
  let one bad premise infect everything after it.
- **Prove, don't assert.** Claims about Engineer behaviour come from wire dumps, his ratings or
  benches — never from reading source or from my synthesis.
