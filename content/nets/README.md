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

So each file is one knob. Both directions sit inside it, each with its own `reviewed` flag (the
per-side `confidence` tag is validated but no longer rendered — founder call 2026-09-01, it had
become a lever ranking), and the knob names its own pair of direction words — stiffer/softer,
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
(`two_answers: false`): rear toe, the diff, anti-squat, anti-dive, body, weight. The
diff and anti-squat split on the throttle, not on time in the corner — that split goes in the line.

```
FRONT ANTI-ROLL BAR | a normal move: 0.1 mm
  STIFFER
    ON THE WAY IN: more initial steering — the front bites sooner and the car turns in quicker, with less roll
    THROUGH THE MIDDLE AND OUT: more understeer through the middle, and the rear feels more planted behind it
  SOFTER
    ON THE WAY IN: less initial steering — the front bites later and turn-in is smoother, with more roll
    THROUGH THE MIDDLE AND OUT: more steering through the middle — less understeer — and the rear feels a little less planted behind it

DIFF OIL | a normal move: 1,000 cSt
  THICKER
    EFFECT: more drive off the corner — both rear tyres put the power down — with more rotation on throttle; …
  THINNER
    EFFECT: less drive off the corner and less rotation on throttle; …
```

Since 2026-09-02 the heading carries no parameter id and there is no WHY line: the ids leaked into
answers (and "FRONT ANTI-DIVE (under_lower_arm_shims_fr)" told every driver anti-dive IS one
chassis's shim), and the WHY line named KB files under a header that forbids naming them. The
second phase label reads AND OUT because the `once_settled` field has always carried exit and
on-power content too. A side whose claim genuinely splits carries a CONTESTED block — both claims
and the on-track discriminator — rendered under its lines.

Damper oil is the proof the shape is right: its THROUGH THE MIDDLE line says *"no change"* on both sides
— `bite-hold.md` is explicit that damping moves *when* load arrives without changing the roll angle
the car ends up at.

**Corner types are never named, and the corner's clock is never asked.** What matters is duration
against the car's roll time, and the Engineer works that out from what the driver has already said
— which corner, where on it, how the car behaved. The question "how long are you turning for, and
how quick?" came out of the prompt on 2026-09-03 (founder: "a lot of drivers would struggle to
answer that accurately"); a contested block's discriminator names something to watch after the
change, never that question. Founder 2026-09-02, still open against `corner-regime.md`: in a
hairpin the car may be in transition for longest, not settled — see that page's founder mark.

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
  before_settled: "..."          # max 170 chars each, in the driver's words (no word list)
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

A line says what a driver can read off the car: responsive or lazy, where on the corner, on or off
the throttle, understeer, rotation, drive, security, how it lets go. It never says a conclusion the
driver could not feel — "the settled share moves to the rear" is physics, and physics lives in
`content/vehicle-dynamics/`. Founder, 2026-09-04: *"use terms that people would use to describe
general car behaviour rather than physics — things a driver can interpret from the handling, not
assume based on physics."*

**There is no word list.** Not a banned one, not an allowed one. The 2026-08-27 ban list (punchy,
crisper, takes a set, wandering, steadier, lazier, twitchy, darty, sharper…) was retired the same
day the founder reached for "lazy" as the driver's word for the opposite of responsive and found it
banned. A list only ever catches what was already complained about; the test is whether a driver
would say it, and that is judged by the founder's pass, not a validator. `bite-hold.md` carries the
same rule and the shared meanings of the words that need one.

**The balance words** — founder-dictated 2026-08-27, defined on `bite-hold.md`:

| Word | Means |
|---|---|
| **understeer / oversteer** | the overall balance |
| **steering** | balance owed to the front |
| **rotation** | balance owed to the rear |
| **forward traction / drive** | the rear putting power down |
| **push** | understeer caused by a lack of rotation from the rear — not a front problem |
| **snap** | a quick oversteer |

These are what the run log records and what these entries are for. Note `push` is a balance word
with a specific meaning.

### `step`

A **normal-sized move**, in the founder's words — not a floor, not a prescription. Shared by both
directions. `null` until he has dictated it, and the renderer omits it. Nothing else may put a
number here: an earlier pass invented, widened or misapplied a figure in ten of sixteen entries, and
this was the field every one of them landed in. Measured from users' setup data is also out
(founder, 2026-08-26: "not yet").

### `usual`

Optional. **Where the knob normally sits**, and where the far end of that is — "about 3° per side;
most cars sit between 2.5° and 3.5°, and 4° is the far end of what is run". Added 2026-09-21 on a
founder yes to "normal values per knob", after the Engineer told a car already on 4° of rear toe-in to
add more, and led seven of ten rear-grip answers with rear toe on cars at 3° to 4°. Rendered on the
heading as `usually runs:`; the nets header says what it is for (a car at the far end has little left
in that lever; blind, say where the end is).

It states where cars SIT, never what a value does — that is a line's job. A range drafted from logged
runs is allowed here, unlike `step`, but only with a YAML comment saying so and that the founder's
pass is owed; his number replaces it the moment he gives one. Most knobs have none, and a knob whose
usual value depends on the surface or the class (ride height, damper oil) gets none until he says how
to split it.

---

## Caps

| Field | Cap |
|---|---|
| each line | 170 chars |
| `step` | 140 chars, or null |
| `usual` | 140 chars, null or absent |
| `label` / each `words` entry | 40 chars |
| `contested` fields | 200 chars each |
| **whole rendered entry (both sides)** | **1,100 chars** |

The rendered ceiling is the one that matters — line caps bound each line, but only a whole-entry
ceiling stops an entry growing back into the one the model favours by bulk.

## Validation

`npm run nets:check` — schema, `id` = `parameter`, the shape on each side matches `two_answers`, no
contested ⇒ both claims + discriminator, `physics` files resolve, render
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

Thirty-seven knobs, all touring, one founder-reviewed side each and the opposite side AI-drafted
(2026-08-27; `nets:check` lists the sides still owed a pass). Not yet written: tyres and inserts, track width, wing. Off-road is a separate
discipline tree, later.

## Knobs deliberately without a net

- **Servo horn** — removed 2026-08-28 (founder): the Engineer was leading a high-grip answer with
  "shorten the servo horn". The knowledge stays in `servo-horn-steering-response.md` so it answers
  when a driver asks; it is not a setup lever to surface unasked.
