# Nets — what a knob most likely does, in the driver's words

**What a net is.** One entry per knob, saying what each direction most likely does on track —
balance, understeer, oversteer, steering, rotation. Probabilistic by design: "most likely", never
"will".

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

## One entry per knob, both directions inside (v5)

v4 wrote each knob in one direction and left the Engineer to invert the sentence. Driven on the
founder's own account (2026-08-27) it never once reached for "softer front bar" for more mid-corner
steering: the roll-centre net literally said *"more front grip through the middle"* and the bar net
said the opposite words in the opposite direction. At decision time a literal line beats a derived
one every time, so the unwritten direction — softening, the everyday move — was never in the
running. Founder call: *"one entry for each parameter, then the net for each direction within it."*

So each file is one knob. Both directions sit inside it, each with its own confidence and its own
`reviewed` flag, and the knob names its own pair of direction words — stiffer/softer,
thicker/thinner, more negative/less negative, higher/lower — so the sheet-sign convention is said
once, in a driver's word, instead of a generic "more/less" gloss.

A side that is not yet written is left out and renders nothing; the block header says the
opposite most likely does the opposite. An AI-drafted side is written with `reviewed: false` —
`npm run nets:check` lists every such side, and that list is what the founder still owes a pass on.
It renders exactly like a reviewed side, on purpose: a draft marker would make the local test read
differently from what ships.

## Two answers or one, decided by behaviour

A knob that **does one thing before the car has settled into the corner and another once it has**
genuinely has two answers. `concepts/corner-regime.md` and `concepts/bite-hold.md` carry the rule.
Which answer matters today depends on how long the corner lasts against how long this car takes to
settle, and the Engineer works that out from the rule plus the facts the request carries. Those
knobs carry **both lines on each side** (`two_answers: true`). The test is the two answers, not the
mechanism (founder, 2026-08-27 — *"it's anything that behaves differently initially and
mid-corner"*): the roll levers are the obvious members, and front toe, caster, Ackermann, rear toe
gain, bump steer and camber split the same way.

A knob that does the same thing throughout the corner carries **one line per side**
(`two_answers: false`): rear toe, the diff, anti-squat, anti-dive, body, weight, servo horn. The
diff and anti-squat split on the throttle, not on time in the corner — that split goes in the line.

```
FRONT ANTI-ROLL BAR (arb_front) | a normal move: 0.1 mm
  STIFFER [consensus]
    ON THE WAY IN: more initial steering — the front bites sooner and the car turns in quicker, with less roll
    THROUGH THE MIDDLE: more understeer through the middle, and the rear feels more planted behind it
  SOFTER [consensus]
    ON THE WAY IN: less initial steering — the front bites later and turn-in is smoother, with more roll
    THROUGH THE MIDDLE: more steering through the middle — less understeer — and the rear feels a little less planted behind it
  WHY: arb.md

DIFF OIL (diff_oil) | a normal move: 1,000 cSt
  THICKER [consensus]
    EFFECT: less rotation off throttle and more rotation on throttle — …
  THINNER [consensus]
    EFFECT: more rotation off throttle and less on throttle — …
  WHY: diff-and-driveline.md
```

Damper oil is the proof the shape is right: its THROUGH THE MIDDLE line says *"no change"* on both sides
— `bite-hold.md` is explicit that damping moves *when* load arrives without changing the roll angle
the car ends up at.

**Corner types are never named.** A hairpin is slow, so it lasts a long time and *is* settled; a
180° hairpin and a 90° sweeper of four times the radius take the same time. What matters is
duration against the car's roll time, and the Engineer gets that from the driver ("how long are you
turning for, and how quick are you going through it?") when it is missing and would change the
answer.

---

## Schema

```yaml
id: arb_front                    # = parameter — one entry per knob
discipline: touring
parameter: arb_front             # canonical setup key — matches the KB **Keys:** vocabulary
label: "Front anti-roll bar"     # what a driver calls it; rendered as the heading
words:
  more: "stiffer"                # what an increase means on this knob, in a driver's word
  less: "softer"                 # …and a decrease. Sheet-sign conventions get said here, once
step: "0.1 mm"                   # a normal-sized move, founder's words, shared by both directions; null until dictated
two_answers: true                # true => before_settled + once_settled per side; false => effect per side
more:
  reviewed: true                 # founder has passed this side; false = AI-drafted
  confidence: consensus          # consensus | majority | contested — per side
  before_settled: "..."          # max 170 chars each, driver's words, no banned coinage
  once_settled: "..."
less:
  reviewed: false
  confidence: consensus
  before_settled: "..."
  once_settled: "..."
  contested:                     # REQUIRED iff that side's confidence is contested
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

**The balance words** — founder-dictated 2026-08-27, on `bite-hold.md`'s closed list:

| Word | Means |
|---|---|
| **understeer / oversteer** | the overall balance |
| **steering** | balance owed to the front |
| **rotation** | balance owed to the rear |
| **forward traction / drive** | the rear putting power down |
| **push** | understeer caused by a lack of rotation from the rear — not a front problem |
| **snap** | a quick oversteer |

These are what the run log records and what these entries are for. Note `push` is a balance word
with a specific meaning and is *not* a coinage — an earlier ban list had it wrong.

### `step`

A **normal-sized move**, in the founder's words — not a floor, not a prescription. Shared by both
directions. `null` until he has dictated it, and the renderer omits it. Nothing else may put a
number here: an earlier pass invented, widened or misapplied a figure in ten of sixteen entries, and
this was the field every one of them landed in. Measured from users' setup data is also out
(founder, 2026-08-26: "not yet").

---

## Caps

| Field | Cap |
|---|---|
| each line | 170 chars, no banned coinage |
| `step` | 140 chars, or null |
| `label` / each `words` entry | 40 chars |
| `contested` fields | 200 chars each |
| **whole rendered entry (both sides)** | **1,100 chars** |

The rendered ceiling is the one that matters — line caps bound each line, but only a whole-entry
ceiling stops an entry growing back into the one the model favours by bulk.

## Validation

`npm run nets:check` — schema, `id` = `parameter`, the shape on each side matches `two_answers`, no
banned coinage on any line, contested ⇒ both claims + discriminator, `physics` files resolve, render
ceiling, no duplicate parameter per discipline, and a list of every side still `reviewed: false`.

---

## Tiers and sources

`drafts/` is the open tier — AI-drafted, not yet founder-reviewed, rendered to the Engineer behind a
hedge divider. Founder review promotes a file into its discipline folder (`touring/`), locked by
`kb-guard` like KB prose. Inside a locked file, a side marked `reviewed: false` is the finer-grained
version of the same thing.

**Trusted draft sources**, in order: Invisible Speed (Joseph Quagraine) — the founder's most trusted
source; his framework (initial vs overall grip, delayed load transfer, the working range) is the
same one the physics KB derives independently. Then the chart-style guides as cross-checks and
disagreement partners: the HUDY/Atack On Road Setup Guide, the Scott Guyatt R/C Handbook, petitrc's
RC CheatSheets, and the XRAY/Hudy setup books. Where a chart contradicts Invisible Speed AND the KB
settles it, the chart is simply wrong. Where trusted sources genuinely split, the side is
`contested` and carries both claims plus a discriminator. Forums are used only to *discover*
contested topics, never as the source of a claim.

## Coverage

Thirty-eight knobs, all touring, one founder-reviewed side each and the opposite side AI-drafted
(2026-08-27). Not yet written: tyres and inserts, track width, wing. Off-road is a separate
discipline tree, later.
