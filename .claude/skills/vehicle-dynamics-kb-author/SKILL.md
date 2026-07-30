---
name: vehicle-dynamics-kb-author
description: How to author, split, or retrofit entries in the RC Engineer vehicle-dynamics knowledge base (content/vehicle-dynamics/, incl. concepts/). Use whenever writing or restructuring KB concept or parameter files — covers the physics-first two-tier structure, the concept layer, the discipline rules, the style, and the founder-gated cluster workflow. LIVING DOC: append new correction-patterns to the log at the bottom as they arise.
---

# Authoring the vehicle-dynamics KB

The Engineer quotes `content/vehicle-dynamics/*.md` **verbatim** to drivers as ground truth. This is
how to write it well the first time so the founder corrects less. It is a **living document** — when
the founder corrects a pattern not captured here, append it to the Correction log.

## Non-negotiables — read first
- **Founder-gated.** Never write or modify an approved KB file without the founder's typed approval on
  the specific diff (`AGENTS.md` hard rule 1; `.claude/rules/engineer-kb.md`). Propose the exact prose,
  wait for "approve"/"yep". Concept files under `concepts/` follow the same gate during the restructure.
- **Setup is ART, not a fixed method.** Never encode a tuning sequence, a priority/ranking, a
  commonality/consensus signal, or a "do this first" recipe. Keep every lever on the table. The KB
  states physics + honestly-hedged effects; the Engineer reasons, it does not prescribe a recipe or
  copy the crowd. (See the roadmap + the founder-memory on this.)

## Structure

### Two tiers, never blurred
1. **`**Physics.**`** — the invariant mechanism. Flat, confident, no hedge. The part that isn't arguable.
2. **`**Effects (context-dependent — confirm on track).**`** — on-track outcomes. Hedged, each with a
   per-effect predictability tag.

**RULE: a Physics fact never reappears as an Effect.** "Adding shims raises RC" is physics — it does
not show up again (tagged) under Effects. If an "effect" is just the mechanism reworded, delete it.

### Concept layer (`concepts/*.md`) — shared facts stated once
Promote a fact to a concept when 2+ parameters share it, or it's a heavy reusable mechanism. Two kinds:
- **Physics-concept** — real, certain. Has a `**Physics.**` block. (load-transfer, roll-center, camber-gain)
- **Feel-concept** — a driver-facing *outcome* caused by physics. **NO Physics block.** Instead a plain
  feel description + a `**Caused by:**` link to the physics. (bite-hold, on-in-track)

Never state a feel as physics, even in a concept. Concepts have **no Effects block** — structurally
they cannot state a handling outcome, so never write "this doesn't decide balance" disclaimers; the
structure already makes it inevitable.

### Balance / understeer–oversteer is the OUTPUT AXIS, not a concept — and NEVER stored
Every parameter affects it, so it is the *vocabulary* the Engineer reasons in (phase entry/mid/exit ×
on/off throttle), never a node — and never a written line. The KB holds each mechanism's **push**
(through the concepts a knob links); the Engineer **sums** those pushes against *this* car + the
driver's data into a hedged tendency at answer time, and reasons *backward* from a symptom the same
way. Store the push; never the net. (See the push-vs-net Correction-log entry — it resolves the old
"state balance impact" / "never editorialize" contradiction.)

### Links — `[[slug]]`, directional, truthful
Target a parameter OR a concept. Label with the real relationship; never force symmetry:
- **`Moved by:`** — a quantity concept pushed by knobs (roll-center `Moved by:` shims).
- **`Affects:`** — this node modulates others (oil-temp `Affects:` damper oil; roll-center `Affects:` bite-hold).
- **`Affected by:`** — the reverse, listed on the receiving node.
- **`Caused by:`** — feel ← physics (bite-hold `Caused by:` load-transfer speed).
- Parameter side is always **`Concepts:`** (unordered — the Engineer applies whichever matches the
  user's question). A `[[slug]]` with no file yet is fine — it marks a link to write later.

### Parameter file shape
**Default (most knobs): Keys + Concepts + Physics only — no Effects block.** Feel, the window, and
every balance/grip **push** live once in the linked concepts and **compose**; restating them on the
knob is the "effects in spring is wrong" mistake.

    ## <Parameter>
    **Keys:** `key_front`, `key_rear`
    **Concepts:** [[concept-a]], [[concept-b]]
    **Physics.** <this knob's own direct mechanism — short; shared physics lives in the linked concepts>

Add an `**Effects (context-dependent — confirm on track).**` block ONLY for a genuine knob-specific
outcome that no linked concept carries — the exception, not the rule. Its bullets are **feels or
pushes** (each `— <predictability>`) plus a `Depends on:` line; **never a balance NET**. A
pure-delegator knob (under-hub, spring-rate) states its mechanism in Physics, links the concept, and
stops. If the END reconstruction test shows the Engineer genuinely can't infer something, that knob
earns an Effects line *then* — not pre-emptively.

## The discipline rules (the corrections, distilled)
- Physics is flat/invariant; Effects are hedged/tagged — **never duplicate one in the other.**
- Separate **feel from physics** (bite/hold is a feel; load-transfer is the physics).
- **Balance is the output axis, not a node.**
- **Never write the balance NET; the Engineer composes it.** Write the mechanism and its **push**
  (via concepts); never state "this split gives understeer / more grip." Push = stored, net = computed.
  Your own both-ways runs (stiffer rear → more grip one day, less another) are why the net can't be frozen.
- **No laundry-listing causes.** Name the direct cause; let each parameter self-link into a feel.
- **Cut anything the Engineer can't act on.** "If it doesn't matter, why should it care." (e.g. a
  negligible ~1% effect gets no ink.)
- **Driver-real language, not internal jargon.** "adding / removing shims," not "raising the stack."
- **Setup is art** — no sequences, rankings, "do this first," or commonality signals.
- **Don't paper over contradictions.** If old prose conflicts with the physics foundation, flag it to
  the founder and get a ruling — don't silently re-home a wrong claim.
- **No coaching** (that lives in the prompt), **no invented numbers.**

## Predictability tags
Four tiers: `reliable | usual | situational | experimental`. They rate how reliably the *effect
appears* — NOT its size, and NOT advice quality. Unknown trigger → tag `situational`/`experimental`
and say the trigger isn't established; never invent a condition. These are the founder's seeded
opinion, not data-derived (data-driven revision is out of scope for now).

## Style
Terse; **bold** technical terms. Preserve `##` heading levels (retrieval splits on `##`). Forbidden
metaphors unless the founder dictated them: *breathe, platforms, dances, comes alive, settles, marries,
talks to, listens, wants, feels like*. Use "tends to / often / typically." Drafts under `drafts/` carry
a provenance banner; approved files do not.

## Physics grounding (web scour)
Before authoring a concept or a knob's **Physics**, scour authoritative **full-size** sources for the
invariant mechanism — vehicle-dynamics texts (Milliken), **FSAE / Tire Test Consortium**, tyre-modelling
and racecar-engineering references. Physics is **size-independent**, so full-size is valid for RC. Rules:
- Import **only non-negotiable mechanisms** (slip angle → lateral force, camber thrust, tyre load
  sensitivity, mechanical trail → self-aligning torque, etc.). **NEVER** a tendency, balance direction,
  or tuning rule — those stay the founder's art and get filtered at the door.
- Cross-check the draft against the source; **sharpen or correct** the mechanism; keep it terse.
- Still **founder-gated** — the web informs the proposal, it does not bypass approval.
- Proven on toe/camber (2026-07-27): confirmed the drafts, sharpened caster (mechanical trail → SAT),
  added camber thrust as a minor term.

## Workflow — by subsystem cluster, NOT alphabetically
Alphabetical fails: one knob is often documented across several feel-named files, so you'd cover it
twice, inconsistently. Instead, per cluster (geometry; spring/damper; diff; aero; weight):
1. **Extraction (read-only)** across every file in the cluster — do it **directly, not via a subagent**
   (agents have confabulated this area). Pull: every physics claim, every feel, every knob→effect
   direction, the key inventory + where each key appears, cross-references/overlaps, and anti-pattern
   content (sequences, balance-direction theory).
2. **Ontology review** — propose the whole cluster's concept set + which param file owns which knob, in
   ONE founder review. Watch for **collapses** (response/sustained turned out to BE bite/hold).
3. **Author** — concepts first, then parameter files **by knob** (one home per knob), each founder-gated.
   Do NOT re-home balance theory into Effects — drop the net; keep Physics + concept links and let the
   push/net split carry it (default knob = Physics + Concepts, no Effects). Cut prescriptive sequences.
4. **Code (after content)** — see coupling below; verify with `npx tsc --noEmit` + `npm run engineer:eval`.

## Coupling to check before restructuring (so a rename/split doesn't break code)
- `parameterEffects/catalog.ts`: each entry cites `kbSource` + `kbSection` (a `## heading`, slugified).
  Currently **empty** → safe to restructure now, but future entries anchor to headings.
- Retrieval (`vehicleDynamicsKb.ts`) keys off setup **keys**, not filenames → **renaming files is safe**.
  It reads `content/vehicle-dynamics/` **non-recursively** — the `concepts/` subfolder is not loaded yet
  (a known code task).
- `kbCoverageManifest` parses headings/keys dynamically; its test uses fixtures, not the real files.

## Worked examples

**Good — a pure-delegator knob (under-hub):** its only mechanism is "raises RC," so it states that in
Physics and points every effect at `[[roll-center]]` rather than re-deriving bite/on-track/camber-gain.

**Good — a feel-concept (bite-hold):** no Physics block; a grip-curve feel description + `**Caused by:**
the speed of load transfer ([[load-transfer]])`.

**Bad — physics restated as an effect:**
`Effects: - Adding shims raises RC — reliable (pure geometry)` ← this is the Physics line with a tag.
Delete it; keep the mechanism in Physics only.

## Correction log (LIVING — append new patterns, newest first, with date)
- 2026-07-30 — "**lower mount inboard** — not sure this line is right - doesnt moving it inboard do
  the opposite?" **COLLAPSED OPPOSING STRANDS (instance of the one-way-chain pattern).** shock-geometry
  stated "lower mount inboard lowers the motion ratio" flat, but an inboard mount move drives TWO
  strands in opposite directions: shorter lever off the arm pivot (lower MR, softer) and a more
  upright shock under a fixed tower top (higher MR, stiffer). Only the angle strand was
  founder-confirmed; the flat net direction was agent composition. **Guard:** when one physical move
  drives two geometric strands, the node states both strands and says the net is geometry-specific —
  never a single direction, even when standard lore agrees with one side.
- 2026-07-30 — "mm idk - thats not really physics imo" (on keeping symptom translations like
  "front bites then washes out = bite without hold"). **SYMPTOM EQUATIONS ARE DIAGNOSIS TEMPLATES,
  NOT DEFINITIONS.** A symptom→concept equation looks like vocabulary but is a canned diagnosis —
  the same feel can have several causes, and the equation short-circuits the reasoning the KB
  exists to enable. **Guard:** driver-language lives only in explicitly-labelled Feel tiers
  (concepts/bite-hold.md's "Feel — not physics" section is the pattern); physics blocks carry
  mechanisms only, never "when the driver says X it means Y" lines.
- 2026-07-30 — "did we just go back to exactly the thing i didnt want about making assumptions?
  this is just physics that cant be argued - saying more likely in higher grip is absolutely
  arguable." **THE TRANSCRIPTION TRAP.** Jordan said in chat "it can free the rear in sweepers,
  probably more so in higher grip — hard to say, not super predictable", and I pasted that INTO the
  draft as an outcome-probability claim ("more likely to show in higher grip") with a founder-ruled
  tag. Founder speech is raw material, not KB prose: his "probably more so in higher grip" is the
  MECHANISM "less cornering force → less transfer to redistribute → the steady-state effect scales
  with grip" — which the draft's Low grip section already derived. The correct edit was NOTHING.
  **New stop-signals:** "founder-ruled: … predictability low", "more likely in", "probably more so",
  any probability adverb attached to an outcome inside KB prose. **Guard:** before writing a founder
  statement into a draft, translate it to the mechanism that produces it and check whether that
  mechanism is already on the node — quote his words in banners/logs only, never as tendency lines.
- 2026-07-28 — "wouldn't this mean the rear would slide more because it has less even load across
  rear tires?" **A ONE-WAY CHAIN IS USUALLY A MISSING TERM IN A NODE, NOT A SETTLED ANSWER.** I built
  "softer rear → runs deeper in travel → RC drops ~1:1 → smaller fast fraction → less rear bite → rear
  won't rotate" and offered it as *giving the founder's hunch a mechanism* — quietly dropping a
  competing strand I had listed myself one message earlier. The root cause wasn't only reasoning:
  `roll-center.md` listed three consequences of RC height (fast fraction, support, jacking) and
  **omitted a fourth** — RC height also sets that axle's **share of the transfer amount**
  (ΔF = axle mass share × h_RC ÷ track × a_y; verified against a load-transfer derivation). A node
  missing a term makes one-way composition *possible*, so the bad chain looks sound from inside.
  **New stop-signals:** "gives your observation a mechanism", "your gut has a mechanism now",
  "it's X-specific in a way Y wasn't". **Guard:** when one number appears in more than one term of the
  physics, enumerate every term ON THE NODE before composing anything; and when a chain runs cleanly
  in one direction, suspect a missing term before believing the answer.
- 2026-07-28 — **Sweep every input the engine takes, not the one the current story is about.** Two
  hypotheses died to `solveAxle` in one session: mine (roll-camber explains rear-specific rotation —
  refuted, camber loss is near-identical front and rear, ~0.05°/deg recovered at both ends) and the
  founder's (camber isn't it — also refuted as stated, but for the *right* reason: camber is nearly
  flat through travel while RC moves ~1.15 mm/mm). The sweep that actually mattered was the one
  neither of us had run — **ride height / travel**, not roll. Run roll AND ride height AND both axles
  before concluding.
- 2026-07-28 — **Web sources give contradictory *directions*; derive direction yourself.** A forum
  asserted "roll understeer = toe-out on compression"; deriving it from the rear-steer phase relation
  (in-phase rear steer = stabilising, the known 4WS result) gave the opposite. Reinforces the existing
  rule — import mechanisms, never tendencies — and adds: when a direction is genuinely needed to reason
  in chat, derive it from a known invariant, never from a forum line.
- 2026-07-27 — "not having the balance is okay as long as the KB can infer it." **PUSH vs NET — the
  structural resolution.** The skill used to say BOTH "parameters state their balance impact directly"
  AND "never editorialize what a knob does to balance" — a contradiction. Fix: a knob states each
  mechanism's **push** (through the concepts it links — e.g. bigger transfer share → that end's grip
  down, via [[tyre-load-sensitivity]]); it NEVER states the **net** (understeer/oversteer/grip
  outcome). The net is the Engineer's live output, summed from the pushes against this car + the
  driver's data, proven at the END reconstruction test — not a KB field. **Structural upshot:** the
  default knob file is **Physics + Concepts, no Effects block**; feel + pushes live once in the
  concepts and compose. An Effects block is the exception (a genuine knob-only quirk), added only if
  the test shows composition fails for that knob.
- 2026-07-27 — "you're using the KB to *explain* a real example that actually goes both ways."
  **THE DRIFT PATTERN, DRESSED-UP VARIANT:** even a properly-hedged composition ("stiffer → less roll
  → better-aligned → reads as grip, but competes with X, net learned on the car") is STILL drift when
  it's framed as *closing* or *explaining* a driver's outcome. New STOP signals: "closes the loop",
  "now fully composes", "explains why X feels like Y", "makes the example make sense", "that closes the
  loop you flagged". A real driver report where the SAME knob gave opposite results (stiffer rear →
  more grip one day, less grip another) is **evidence FOR openness**, not a puzzle the KB should
  resolve in one direction. **Guard:** the KB's job is to hold every competing strand as a primitive
  and pair them with the driver's actual conditions — never to derive/explain which way an outcome
  went. Adding a new true strand enriches the tension; it does not settle it. Litmus: "if the KB could
  resolve this, setup wouldn't be art and everyone would run the same sheet."
- 2026-07-26 — "we're talking in physics again — setup is art, there's no locked inversion, no one has
  100% answers, everyone is learning." **THE DRIFT PATTERN (watch for it constantly):** when two true
  mechanisms compete, the model manufactures a single resolved answer — "the dominant mechanism", "the
  inversion", "the real reason", "X beats Y", "reliable tendency", "reconciles to" — to close the
  tension into a directional rule. That IS the orthodoxy setup-is-art forbids. Those words are STOP
  signals. **Guard:** state each real mechanism as a primitive; leave the *net* genuinely open
  (situational/experimental); never say which one wins. Humility ("what nets out is learned on the
  car") is content the Engineer embodies, not a disclaimer. Root cause: a prior toward closure /
  correctness fights the domain truth that the net of many mechanisms on a real car is not derivable —
  "physics-first" means the *primitives* are certain, NOT the outcome.
- 2026-07-25 — "the first effect is basically the physics bit reworded" → a Physics fact never reappears
  as a tagged Effect.
- 2026-07-25 — "if it doesn't matter, why should the engineer care" → cut caveats the Engineer can't act
  on (a proven-negligible mechanism gets no ink).
- 2026-07-25 — "'raising the stack' is misleading" → driver-real language over internal jargon.
- 2026-07-25 — extraction surfaced response/sustained = bite/hold verbatim → hunt for concept collapses
  before authoring; alphabetical retrofit hides them.
- 2026-07-23 — "literally everything affects understeer/oversteer" → balance is the output axis, not a
  concept.
- 2026-07-23 — bite/hold "isn't physics, it's a feel" → feel vs physics split; feel-concepts get no
  Physics block, only `Caused by:`.
- 2026-07-23 — "don't determine what a split does to balance — make it inevitable" → never editorialize
  balance direction; it falls out of the foundation.
- 2026-07-23 — a "commonality"/tuning-sequence tier was designed then killed → setup is art; no ranking,
  order, or consensus signal as truth.
