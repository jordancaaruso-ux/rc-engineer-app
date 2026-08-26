# Nets — the knobs, pointed at the sliders

**What a net is.** One entry per (parameter, direction), saying which **slider** that knob moves,
which way, and one line of what the driver notices. Four or five lines. Nothing more.

**What a net is not.** Physics, and not conditions either. The mechanism lives in
`content/vehicle-dynamics/`. The conditions — what makes the effect bigger, smaller, or worth the
opposite move today — live in the **slider** files, `content/vehicle-dynamics/concepts/`, written
once and shared by every knob that touches them.

---

## The idea

Every knob on the car is a slider. Too far one way is bad, too far the other way is bad, and the
good spot moves with the day — grip, corner speed, how rough the surface is.

v1 and v2 both wrote that out separately for all sixteen knobs, and both broke the same way. v1
entries ran 1,382 to 3,551 bytes; the model reads them all at once and leans on the longest, so a
knob got attention for being wordy rather than right, and ten of sixteen carried a step size that
was invented or misapplied. v2 imposed a fixed six-box grid, which fixed the length spread and made
three things worse: half the feel lines were the physics KB restated somewhere shorter and more
scannable — so a net could stand in for the physics instead of pointing at it — the grid forced 55
of 96 boxes to be filled or declared empty with no source, and per-knob condition tables were about
to multiply all of it.

v3 writes each slider down **once** and has every knob point at it.

**No switches.** An earlier v3 draft had per-knob flip conditions — "at very high grip this
reverses". Grip does not flip anything. The good spot slid toward the hold end, so a car already at
the bite end is now past it. A threshold inside a knob is a bucket wearing a disguise, which is why
`flips`, `modifiers` and the six-box grid are all rejected by the validator.

---

## The three pieces

```
content/vehicle-dynamics/*.md           why a change does what it does          [locked]
content/vehicle-dynamics/concepts/*.md  the sliders: each end's feel, and       [locked]
                                        what moves the good spot
content/nets/drafts/<slug>.yaml         which slider, which way, one line       [open]
content/nets/touring/<slug>.yaml        the same, founder-reviewed              [locked]
```

Phase, grip level and corner speed are **never stored per knob** — they fall out of the sliders.
`bite-hold.md` already states that phase is which part of the grip build the driver samples, so a
knob that moves the bite end is an entry-phase answer without anything here saying so.

---

## Schema

```yaml
id: front_arb_stiffer            # stable key: <parameter>_<direction-word>
discipline: touring
change:
  parameter: arb_front           # canonical setup key — matches the KB **Keys:** vocabulary
  direction: increase            # increase | decrease
  step: null                     # a normal-sized move, in the founder's words; null until dictated
moves:                           # max 4; one slider, one end, one direction each
  - slider: bite-hold            # a file in concepts/ — must resolve, and must have a vocabulary
    end: front                   # front | rear | car
    toward: bite                 # one of the two words SLIDER_VOCAB declares for this slider
    confidence: consensus        # consensus | majority | contested
  - slider: bite-hold
    end: rear
    toward: hold
    confidence: majority
    relative: true               # a knock-on from moving the other end, not a direct action
feel: "the front gets more pointy and precise"   # ONE line, closed vocabulary, max 130 chars
contested:                       # REQUIRED iff any move has confidence: contested
  claim_a: "..."
  claim_b: "..."
  discriminator: "what you'd see on track that decides it today"
physics:                         # parameter-level files in content/vehicle-dynamics/
  - arb.md
sources:                         # authoring record only — never rendered, never named to a driver
  - "Invisible Speed (Joseph Quagraine) — anti-roll bar transcripts"
```

### The slider vocabularies

`toward` is not free text. Each slider declares its two words in `SLIDER_VOCAB` in
`src/lib/engineer/netsSchema.ts` — `bite-hold` takes `bite | hold`, `damping` takes
`slower | faster`, and so on. That table lives in **code, not in the concept files**: those files
are plain prose with no header block and are locked by `kb-guard`, so declaring a vocabulary inside
each would be twenty founder-gated diffs for what is plumbing.

Adding a knob that needs a slider nobody has written yet is a **finding, not a blocker** — the
validator names it and the entry stays honest about the gap. That is how droop's working range
surfaced: droop's main effect is how far the car can pitch and roll before a wheel tops out, and
there is no concept file for it. Both droop entries say so in their header.

### The feel line

`concepts/bite-hold.md` carries the **closed list** of words allowed for describing feel — *bite,
initial grip, overall grip, hold, precise, pointy, planted, forgiving, numb, unpredictable,
imprecise, smoother, more rolled-in, on the track, in the track, entry, mid-corner, on power*, plus
`responsive` reserved for on-the-track / initial bite only. It also carries the rule that matters
more than the list:

> anything outside it is not a feel word that needs replacing with a better adjective, it is a sign
> the change has not been understood well enough to predict its feel — in which case say what the
> change does **mechanically**, or name **where in the corner** and **what the car does there**, and
> stop.

The validator enforces this as a **banned-coinage list**, not an allowed list — an allowed list is
unenforceable on free text, which legitimately contains "the", "on", "track". It is seeded with the
coinages `bite-hold.md` names itself (punchy, crisper, takes a set, skatey, on top of it,
nervous-feeling) plus every one v1 and v2 introduced and shipped (pushes, wandering, steadier,
lazier, twitchy, darty, sharper).

**Known word gaps, awaiting founder additions:** the closed list has no word for understeer,
oversteer, steering, rotation or forward traction — the words the run log itself uses. `diff-oil`
and `camber-rear` currently breach it and say so in their headers. Each addition should name the
slider and end it points at, so a logged run can be translated into a candidate knob by lookup
rather than by guess.

### `step`

A **normal-sized move**, in the founder's words — not a floor, not a prescription. `null` until he
has dictated it, and the renderer simply omits it. Nothing else may put a number here: an earlier
pass invented, widened or misapplied a figure in ten of sixteen entries, and this was the field
every one of them landed in.

---

## Caps

| Field | Cap |
|---|---|
| `feel` | 130 chars, no banned coinage |
| `moves` | max 4 |
| `step` | 140 chars, or null |
| `contested` fields | 200 chars each |
| **whole rendered entry** | **700 chars** |

The rendered ceiling is the one that matters — field caps bound each line, but only a whole-entry
ceiling stops an entry growing back into the one the model favours by bulk. v3 currently renders
204–355 chars per entry (1.74× spread) against v2's 563–1,374 (2.44×), and the whole block is about
1,151 tokens against v2's 4,175.

---

## Validation

`npm run nets:check` — schema, slider files resolve, `toward` in vocabulary, no banned coinage,
contested ⇒ both claims + discriminator, `physics` files resolve, render ceiling, no duplicate
(parameter, direction) per discipline.

---

## Tiers and sources

`drafts/` is the open tier — AI-drafted, not yet founder-reviewed, rendered to the Engineer behind a
hedge divider. Founder review promotes a file into its discipline folder (`touring/`), locked by
`kb-guard` like KB prose.

**Trusted draft sources**, in order: Invisible Speed (Joseph Quagraine) — the founder's most trusted
source; his framework (initial vs overall grip, delayed load transfer, the working range) is the
same one the physics KB derives independently. Then the chart-style guides as cross-checks and
disagreement partners: the HUDY/Atack On Road Setup Guide, the Scott Guyatt R/C Handbook, petitrc's
RC CheatSheets, and the XRAY/Hudy setup books. Where a chart contradicts Invisible Speed AND the KB
settles it, the chart is simply wrong. Where trusted sources genuinely split, the move is
`contested` and carries both claims plus a discriminator. Forums are used only to *discover*
contested topics, never as the source of a claim.

## Coverage

Sixteen entries today. The next levers worth writing are the ones that appear on real setup sheets
and in real questions — shock position, track width, chassis flex, wing, anti-squat, tyres and
inserts. Roll-centre knobs are deliberately absent: the KB already carries them founder-verified and
solver-checked. Off-road is a separate discipline tree, later.
