# Nets — what a knob most likely does, in the driver's words

**What a net is.** One entry per (parameter, direction), saying what that change most likely does
on track — balance, understeer, oversteer, steering, rotation. Probabilistic by design: "most
likely", never "will".

**What a net is not.** Physics, conditions, or mechanism. *Why* a change does what it does lives in
`content/vehicle-dynamics/`. *What makes it bigger, smaller, or worth the opposite move today* lives
in `content/vehicle-dynamics/concepts/`, written once and shared by every knob. A net links to those
(`physics:`) and never repeats them.

**Why that boundary is strict.** The physics KB's own header says it stores *"mechanisms, not
outcomes... because the same change genuinely goes both ways on different days."* A net states the
outcome anyway — that is its whole value and its whole risk. And `understeer` / `oversteer` appear
nowhere in the physics KB: outcomes are the one thing a net carries that nothing else does, so they
are the only thing it carries. Three earlier formats died of putting more in: free prose that grew
until the model favoured the fattest entry, a six-box phase grid whose "feel" lines were physics
restated, and a slider index that duplicated what the KB already says about which lever a knob
moves. Do not rebuild any of them. Founder interview, 2026-08-26/27.

---

## Two shapes, decided by physics

A knob that changes **how much or how fast the car rolls and transfers load** — bars, springs,
damper oil, ride height, droop — genuinely has two answers: one before the car has settled into the
corner, one once it has. `concepts/corner-regime.md` and `concepts/bite-hold.md` carry the rule.
Which answer matters today depends on how long the corner lasts against how long this car takes to
settle, and the Engineer works that out from the rule plus the facts the request carries. Those
knobs carry **both lines**.

A knob that acts through another mechanism — camber, toe, diff, caster — does one thing whatever
the corner's clock says, and carries **one line**.

```
CHANGE: arb_front increase [consensus]
  BEFORE THE CAR SETTLES: more initial steering — the front bites sooner and the car turns in quicker
  ONCE SETTLED: more understeer through the middle, and the rear feels more planted behind it
  WHY: arb.md

CHANGE: camber_front increase [consensus]
  EFFECT: more steering, most of it mid-corner; it lets go more abruptly, and how much you get depends on the tyre
  WHY: camber.md
```

The unevenness is the physics talking, which is the only kind allowed. Damper oil is the proof the
shape is right: its ONCE SETTLED line says *"no change"* — `bite-hold.md` is explicit that damping
moves *when* load arrives without changing the roll angle the car ends up at — and that is a real
claim a six-box grid could only express as five empty boxes.

**Corner types are never named.** A hairpin is slow, so it lasts a long time and *is* settled; a
180° hairpin and a 90° sweeper of four times the radius take the same time. What matters is
duration against the car's roll time, and the Engineer gets that from the driver ("how long are you
turning for, and how quick are you going through it?") when it is missing and would change the
answer.

---

## Schema

```yaml
id: front_arb_stiffer            # stable key: <parameter>_<direction-word>
discipline: touring
change:
  parameter: arb_front           # canonical setup key — matches the KB **Keys:** vocabulary
  direction: increase            # increase | decrease
  step: null                     # a normal-sized move, founder's words; null until dictated
roll_lever: true                 # true => before_settled + once_settled; false => effect
before_settled: "..."            # max 170 chars each, driver's words, no banned coinage
once_settled: "..."
confidence: consensus            # consensus | majority | contested
contested:                       # REQUIRED iff confidence is contested
  claim_a: "..."
  claim_b: "..."
  discriminator: "what you'd see on track that decides it today"
physics:                         # files in content/vehicle-dynamics/ — the anti-substitution hook
  - arb.md
sources:                         # authoring record only — never rendered, never named to a driver
  - "Invisible Speed (Joseph Quagraine) — anti-roll bar transcripts"
```

### The words

`concepts/bite-hold.md` carries the closed list of feel words — *bite, initial grip, overall grip,
hold, precise, pointy, planted, forgiving, numb, unpredictable, imprecise, smoother, more rolled-in,
on the track, in the track, entry, mid-corner, on power* — and the rule that matters more than the
list:

> anything outside it is not a feel word that needs replacing with a better adjective, it is a sign
> the change has not been understood well enough to predict its feel — in which case say what the
> change does **mechanically**, or name **where in the corner** and **what the car does there**, and
> stop.

The validator enforces this as a **banned-coinage list**, not an allowed list — an allowed list is
unenforceable on free text. It is seeded with the coinages `bite-hold.md` names (punchy, crisper,
takes a set, skatey, on top of it, nervous-feeling) plus every one earlier drafts shipped (pushes,
wandering, steadier, lazier, twitchy, darty, sharper).

**The balance words** — understeer, oversteer, steering, rotation, forward traction — are what the
run log records and what these entries are for. They are not on the closed list yet; the founder is
dictating the additions, each mapped to what it points at.

### `step`

A **normal-sized move**, in the founder's words — not a floor, not a prescription. `null` until he
has dictated it, and the renderer omits it. Nothing else may put a number here: an earlier pass
invented, widened or misapplied a figure in ten of sixteen entries, and this was the field every one
of them landed in. Measured from users' setup data is also out (founder, 2026-08-26: "not yet").

---

## Caps

| Field | Cap |
|---|---|
| each line | 170 chars, no banned coinage |
| `step` | 140 chars, or null |
| `contested` fields | 200 chars each |
| **whole rendered entry** | **600 chars** |

The rendered ceiling is the one that matters — line caps bound each line, but only a whole-entry
ceiling stops an entry growing back into the one the model favours by bulk.

## Validation

`npm run nets:check` — schema, the shape matches `roll_lever`, no banned coinage on any line,
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
settles it, the chart is simply wrong. Where trusted sources genuinely split, the entry is
`contested` and carries both claims plus a discriminator. Forums are used only to *discover*
contested topics, never as the source of a claim.

## Coverage

Sixteen entries today, all touring. Next worth writing: shock position, track width, chassis flex,
wing, anti-squat, tyres and inserts. Roll-centre knobs are deliberately absent — the KB already
carries them founder-verified and solver-checked. Off-road is a separate discipline tree, later.
