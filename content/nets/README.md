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

## Schema

```yaml
id: front_arb_stiffer            # stable key: <parameter>_<direction-word>
discipline: touring              # touring | offroad-1-8 | ...
change:
  parameter: arb_front           # canonical setup key — must match the KB **Keys:** vocabulary
  direction: increase            # increase | decrease
  typical_step: "one wire size (~0.1–0.2 mm)"   # optional
effects:                         # phase × power × end, driver language
  - phase: entry                 # entry | mid | exit | all
    power: off-power             # on-power | off-power | braking | any
    end: front                   # front | rear | car
    feel: "sharper initial steering, car stays flatter"
    confidence: consensus        # consensus | majority | contested
secondary_effects:               # optional, plain strings
  - "rear gains relative side grip — front/rear bar stiffness is a coupled axis"
dose_response: monotonic         # monotonic | to_a_point | threshold
modifiers:                       # optional; the reason nets exist
  - context: "very high grip (carpet, additive asphalt)"
    action: attenuates           # amplifies | attenuates | reverses
    note: "high bite tolerates the bar — controlling roll is its main use case there"
contested:                       # REQUIRED iff any effect confidence == contested
  claim_a: "majority: softer/no front bar on low grip — the car needs roll to work the tyre"
  claim_b: "minority: stiffer on low grip keeps the platform calm and the tyre flat"
  discriminator: "if the car rolls to the outer edge and snaps sideways, run claim B; if it slides progressively, claim A"
physics_link:                    # every entry resolves to a file in content/vehicle-dynamics/
  - arb.md
  - concepts/roll-stiffness.md
sources:
  - "petitrc RC CheatSheets"
```

Validation: `npm run nets:check` (schema completeness, contested ⇒ both claims + discriminator,
every `physics_link` resolves, no duplicate (parameter, direction) per discipline).

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
