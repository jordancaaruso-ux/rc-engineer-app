# Vehicle-dynamics KB authoring corrections — observation log

Extracted from the vehicle-dynamics-kb-author skill on 2026-07-31 when that skill was deleted.
Carries Jordan's “physics that cannot be argued” test and the transcription-trap ruling.
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
