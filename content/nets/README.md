# Nets — empirical setup priors

**What a net is:** one entry per (parameter, direction) saying what that change *most likely
feels like* on track, and — the whole reason this artifact exists — **what context flips or
mutes the effect**. Nets are change-first (the transpose of every symptom→fix guide in the
wild) because drivers ask both "what should I change?" and "what happens if I change this?",
and the second can't be answered from a symptom table.

**What a net is not:** physics. The mechanism (*why* the effect happens) lives in the physics
KB at `content/vehicle-dynamics/` and every net links into it via `physics_link`. A net that
can't be explained by the KB is either missing a modifier or belongs at `confidence: contested`.

**Epistemics:** nets are probabilistic by design — "most likely", never "will". They are NOT
held to the KB's "cannot be argued" bar. Most famous forum contradictions (bar stiffness on low
grip, droop, springs on carpet) are one unstated modifier — usually that the value of chassis
roll flips sign with grip level. Encode the flip as a `reverses` modifier and the contradiction
disappears. Genuinely unresolved effects are marked `contested` and carry both claims plus a
**discriminator**: the on-track observable that tells *this* driver which claim applies today.

**Tiers:** `drafts/` is the open tier — AI-drafted from trusted sources, not yet
founder-reviewed, and rendered to the Engineer with a hedge divider (same convention as the KB).
Founder bulk-review promotes a file up into its discipline folder (`touring/…`), which is locked
by kb-guard like KB prose.

**Trusted draft sources**, in order: Invisible Speed (Joseph Quagraine) — the founder's most
trusted source; video/course transcripts are the primary basis for drafts, and his framework
(initial vs overall grip, delayed load transfer, the working range) is the same one the physics
KB derives independently. Then the chart-style guides as cross-checks and disagreement partners:
the HUDY/Atack On Road Setup Guide, the Scott Guyatt R/C Handbook, petitrc's RC CheatSheets, and
the XRAY/Hudy setup books. Where a chart contradicts Invisible Speed AND the KB settles it, the
chart is simply wrong (the "stiffer bar = more grip" lore); where trusted sources genuinely
split, the entry is `contested`. Forums (RCTech, oOple) are used only to *discover* contested
topics — never as the source of a claim.

## Layout

```
content/nets/
  README.md            this file
  touring/<slug>.yaml  reviewed entries, one file per (parameter, direction)  [locked]
  drafts/<slug>.yaml   AI-drafted entries awaiting bulk review                [open]
```

## Schema (v2 — the fixed grid)

**Why it is fixed.** v1 let an entry be any shape, and entries ranged 1,382 to 3,551 bytes.
The model reads the whole block at once and favours the fattest entry in it, regardless of
whether that lever is the right answer — length was carrying weight it had not earned, which
is failure mode #2 (generic advice) arriving through the back door. v2 makes every entry the
same shape by construction. Founder interview, 2026-08-25.

```yaml
id: front_arb_stiffer            # stable key: <parameter>_<direction-word>
discipline: touring              # touring | offroad-1-8 | ...
change:
  parameter: arb_front           # canonical setup key — must match the KB **Keys:** vocabulary
  direction: increase            # increase | decrease
  typical_step: "0.1 mm is both the smallest move that registers and the usual one"
effects:                         # EXACTLY the six cells below, always, in any file order
  - phase: entry                 # entry | mid | exit
    end: front                   # front | rear
    tag: grip_earlier            # machine-readable; NOT rendered to the model
    feel: "the front takes its load sooner, so its grip arrives earlier"
    confidence: consensus        # consensus | majority | contested
  - phase: entry
    end: rear
    tag: none                    # "nothing reliable happens here" — a claim, not an omission
overall: "the car changes direction sooner and rolls less doing it"   # optional, max ONE
dose_response: to_a_point        # monotonic | to_a_point | threshold
modifiers:                       # optional, max TWO — the reason nets exist
  - context: "extremely high grip, where the car has stopped sliding"
    action: reverses             # amplifies | attenuates | reverses
    note: "a thinner front bar gives you time to react; a stiff bar leaves none"
contested:                       # REQUIRED iff any effect confidence == contested
  claim_a: "..."
  claim_b: "..."
  discriminator: "the on-track observable that tells this driver which claim applies today"
physics_link:                    # every entry resolves to a file in content/vehicle-dynamics/
  - arb.md
  - concepts/corner-regime.md
sources:                         # authoring record only — never rendered, never named to a driver
  - "Invisible Speed (Joseph Quagraine) — anti-roll bar transcripts"
```

### The six cells

`entry | mid | exit` × `front | rear`. All six present in every entry. A cell where the change
does nothing dependable is `tag: none` and renders as **"nothing reliable"** — *"a stiffer front
bar does nothing reliable on exit"* is a real claim, it stops the model inventing one, and it is
why damper oil's mid-corner cells are empty on purpose (damping acts on movement; once roll has
settled there is no movement left for it to act on).

**The on-power / off-power axis is folded into the phase.** In touring, entry is off-power or
braking and exit is on-power. Carrying both axes tripled the rows for no extra information and
was a main source of the length spread.

**Never collapse a lever to one direction.** `concepts/corner-regime.md` states once that how
much of a corner is entry-versus-settled moves with speed, grip and corner shape — so a faster
car spends more of the corner in transition, and the ENTRY row is the one that dominates for it.
Because every net answers entry and mid *separately*, that single law composes across all of
them for free. Restating it inside entries is exactly the duplication v2 exists to remove.

### The duplication rule

**A net may not restate anything the physics KB already says.** It links (`physics_link`); it
never repeats. v1's `secondary_effects` was where entries got fat, and most of what it held was
`arb.md` and `spring-rate.md` paraphrased — the same claim in two places reads to the model as
two independent sources agreeing, which manufactures confidence out of nothing. The field is
removed and the validator rejects it. An end-scoped claim goes in its grid cell, a car-level one
in `overall`, a context flip in `modifiers`, and mechanism goes in the KB or nowhere.

### `tag`

Coded effect direction, scoped to the cell's `end` — `grip_more` at the front reads as steering,
at the rear as security. `grip_earlier` / `grip_later` are *timing* rather than amount: the
corner-regime hook, and the reason one lever can honestly say "more grip" on entry and "less
grip" mid-corner in the same entry.

It is deliberately **not rendered to the model**. It exists so code can later compute *"which
levers touch mid-corner front grip"* deterministically instead of the model choosing by feel.
Rendering it would only invite the model to parrot the vocabulary, and cost tokens for nothing.

### `typical_step` — scale sense, not a prescription

What size of move actually registers, and what size the driver's peers typically make. **Measured
from real consecutive-run setup deltas** (452 pairs, 4–6 distinct drivers per lever, 2026-08-25),
never paraphrased from a guide — an earlier pass invented or misapplied numbers in ten of sixteen
entries, and `typical_step` was the field every one of them landed in.

Two levers carry no number and say so:

- **Droop** — median delta 0.2 mm but 75th percentile 16.6 mm. That is not a big move, it is two
  sheet conventions (gap in mm vs block height) sitting in one column.
- **Diff oil** — 6 changes across 2 drivers. Too thin to quote.

The data measures **what drivers do, not what is correct**, and it is a handful of drivers. It is
calibration, not authority — write it that way.

### Caps, and why they are enforced

`npm run nets:check` rejects an entry that breaks any of them, so a fat entry cannot be committed:

| Field | Cap |
|---|---|
| `feel` | 150 chars |
| `overall` | 170 chars, max one |
| `typical_step` | 150 chars |
| `modifiers` | max 2 · context 80 · note 200 |
| `contested` fields | 200 chars each |
| **whole rendered entry** | **1,500 chars** |

The rendered ceiling is the one that matters: per-field caps bound each line, but only a whole-
entry ceiling stops an entry growing back into the one the model favours by bulk. v2 currently
renders 563–1,374 chars against v1's 1,382–3,551 bytes of source.

Validation also checks: contested ⇒ both claims + discriminator, every `physics_link` resolves,
no duplicate (parameter, direction) per discipline.

## How the Engineer renders confidence

Stated in the nets block header the model reads, and repeated here for authors:

- `consensus` → state it plainly.
- `majority` → state it, naming the minority view when the driver's context matches it.
- `contested` → present both claims and the discriminator. Never pick silently.

## Coverage plan

Start with the ~25–30 levers that appear on real setup sheets and in real Engineer questions
(springs, damper oil, bars, camber/links, toe, droop, ride height, roll centre, diffs,
anti-squat, tyres/inserts). Full touring coverage is estimated at 60–80 entries. Off-road is a
separate discipline tree, later.
