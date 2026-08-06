# Vehicle-dynamics KB authoring corrections — observation log

Extracted from the vehicle-dynamics-kb-author skill on 2026-07-31 when that skill was deleted.
Carries Jordan's “physics that cannot be argued” test and the transcription-trap ruling.
## Correction log (LIVING — append new patterns, newest first, with date)
- 2026-08-06 — **WIRING THE THIN KNOBS DID NOT MOVE WHICH LEVER GETS PICKED FIRST. THE COUNT WAS
  THE WRONG INSTRUMENT.** `spring-rate` (43→~440 w), `arb` (92→~450) and `damper-oil` (45→~430)
  were rewritten to be self-sufficient — direction, a condition split indexed on something the
  driver has already said, and a scaling line — on the theory that the diff wins because it is the
  only node an answer can be read straight out of. Measured on 12 questions before and after:
  **the diff still led 3 of 7 non-throttle cases, the same three.** The "assembly beats linkage"
  theory is not confirmed as the cause of *first-lever choice*.
  **What did change is invisible to that count, and is the real result.** Before, "the car pushes
  on entry into the hairpin" got one lever (thinner diff) and a clarifying question. After, it got
  the diff *for the off-throttle case*, then softer rear roll stiffness with the reason — "in a
  hairpin the car is still moving into roll" — then front roll centre, having worked out the
  regime from the corner name **without asking**. "I lose the rear, mostly smooth" went from three
  diff bullets to soften-rear-ARB for a sweeper and **stiffen**-rear-ARB for a hairpin, the two
  mechanisms with opposite signs indexed to named corners.
  **Guard:** counting which lever is named first cannot see a corpus change that improves what
  comes second and third, and the diff leading an off-throttle rear question is correct physics,
  not a failure. Founder's call on the metric, before the result was in: *"shouldn't be aiming for
  a specific number of references"* — right, and this is the evidence. Lever counts are a detector
  for whether behaviour moved at all; only reading the answers says whether it improved.
  Re-runnable with `scripts/engineer-bench/lever-set.json` + `lever-distribution.ts` (the results
  files themselves are gitignored, so re-measure rather than hunt for them).
- 2026-08-06 — "this line should be deliberate, not sometimes the engineer suggests this" (in-app 7/10
  on a camber re-check). **A "VERIFIED" LABEL IS WHY NOBODY RE-CHECKS IT.** `upper-link-geometry.md`
  carries the per-key sign table and instructs the reader "Read the sign here. Do not derive it." Two
  of its four rows had the camber-gain column inverted (`under_lower_arm_shims_*` and
  `under_hub_shims_*` said **less**; the solver says **more**). The RC column matched the solver
  exactly, so the error entered when the camber column was transcribed, not from the solver. It
  survived five days *because* the block was stamped "solver-verified 2026-08-01" — the stamp reads as
  a completed check and stops anyone re-running it, while the surrounding "do not derive" instruction
  disarms the one defence (a reader noticing the physics looks off). Two parameter files stated the
  coupling correctly the whole time and were the only reason the contradiction was visible at all.
  **Guard:** a provenance stamp covers the run that produced the numbers, NOT the transcription into
  prose — re-derive any table that a KB entry designates as the authority, and cross-check it against
  every file that restates the same coupling. Re-run: `computeAxleMetrics` from `src/lib/rollCenter/`
  over the pack with ±0.5 mm on each knob. Second finding from the same run: **higher ride height
  raises RC but REDUCES camber gain** — the one move that breaks the coupling, so the coupling belongs
  to moving a pickup point and must never be stated as a property of roll centre itself.
- 2026-08-06 — "anything can effect bump comp, spring, arb, damping, flex, roll center. What you're
  stating is a static rule, not something that can be derived" (caught twice in one edit: first the
  `Affected by:` line, then the reworded inline version). **A LIST OF CAUSES IS A STATIC RULE.**
  `bump-compliance.md` named spring, damping and droop as what affects it. The list was not wrong, it
  was closed — ARB, chassis flex and roll centre all affect bump compliance and none were on it. An
  entry that names its causes can only answer for the causes it named. State instead the property the
  causes act *through*, phrased so any lever can be tested against it: bump compliance became "what
  the movement has to fight on its way from tyre to chassis — what resists the wheel rising, what
  ties it to the other wheel, what routes load through the links instead of the springs, what gives
  instead of the suspension." Four mechanisms, no parts named, and every listed cause falls out of
  one of them. **Guard:** a concept file that enumerates parts is a lookup table; rewrite it as the
  rule that generates them. Symptom: the Engineer ignores a relevant lever because the concept file
  didn't happen to list it.
- 2026-08-05 — "seems to surface quite a lot", "again loves mentioning diff a lot", "not my first
  pick" (three separate ratings in one batch). **UNEVEN DEPTH IS NOW A BEHAVIOUR BUG, NOT A TODO.**
  Retrieval is gone: Engineer v0 ships the whole corpus every turn, so the model is choosing among
  files that all arrive together. It reaches for whichever node is written most completely.
  `diff-and-driveline.md` carries a founder-confirmed sign, an on/off-throttle split AND composed
  outcomes; `droop-downstop.md` is six lines with two links; kerbs are absent entirely. The diff was
  not over-weighted by anything — it was simply the only place a full answer could be assembled.
  **Guard:** relative completeness across neighbouring nodes is itself a ranking signal now. When
  one node is materially deeper than the knobs it competes with, that is a live defect either way —
  and the fix direction is a founder call: he ruled **level the deep node down** (strip the diff's
  composed outcomes) rather than write the thin ones up, because the deep node was breaking PUSH vs
  NET (2026-07-27) to get there. A node that wins by breaking the corpus rule is not a model to
  copy.
- 2026-08-05 — "the kb isnt clear enough on this point. its about corner regime but the engineer
  doesnt always interpret it right", and separately "id guess softer rear could give more steering,
  not stiffer". **A COMPOSED CHAIN GETS QUOTED AS THE ANSWER, CONDITIONS AND ALL LEFT BEHIND.**
  `corner-regime.md`'s steady-state paragraph derives the push correctly (the stiffer end gives up
  side grip) and then appends the fully composed "classic chain: stiffer rear → less rear side grip
  → more mid/exit steering". The Engineer quoted the chain, not the derivation, and the founder's
  own instinct went the other way on his car. Ruling when asked whether to invert it: **"the gap in
  the specifics to capture nuance accurately"** — so the direction is not wrong and roll stiffness
  stays the frame; what is missing are the conditions that decide how far the chain carries.
  **Guard:** the same PUSH vs NET rule that governs knob files governs concept files. A concept may
  derive a push and must stop there; a chain written out to a balance outcome will be lifted whole,
  and every condition stated around it is invisible next to it. Related tell to the 2026-08-04 "net
  tendency" entry — this one arrives as an appositive ("this is the classic chain") rather than a
  summary sentence.
- 2026-08-04 — "on low grip, stiffness changes do less overall i dont think thats true - if its in the
  kb remove it". **A "NET TENDENCY" LINE IS A COMPOSED VERDICT, NOT MECHANISM.** `corner-regime.md`'s
  low-grip paragraph stated two mechanisms — less cornering force means less transfer for the
  steady-state mechanism to redistribute, and slower corners give the chassis more time to reach
  steady state — then closed with "Net tendency: on low grip, stiffness changes do less overall, and
  what remains is mostly the timing mechanism." Founder kept both mechanisms and cut the net sentence
  only. **Guard:** a paragraph that establishes two strands must stop there. The word "net" (also
  "overall", "on balance", "what remains is mostly") is the tell that a verdict is being composed out
  of primitives — the same failure as COLLAPSED OPPOSING STRANDS below, but arriving as a summary
  sentence at the end of a paragraph rather than inside a bullet. Note the heading already said
  "tendency, not a law" and that hedge did **not** save it; a labelled tendency is still a verdict the
  model will quote. Observed live: the sentence was about to steer a worked answer away from stiffness
  levers entirely on a low-grip layout.
- 2026-08-01 — "Pretty good - but the camber gain direction is wrong" (in-app rating 7/10 on an answer
  that said lowering the inner lower pickups front and rear gives **more** camber gain).
  **AN ASYMMETRIC BRANCH PAIR IS A COMPOSITION TRAP.** `under-lower-arm.md`'s Physics block stated the
  coupling correctly — RC and camber gain move together — but the Effects bullet listed camber gain only
  on the `higher →` branch and gave the `lower →` branch "more roll" in its place. Nothing in the file
  was false. The model read the branch it needed, found roll and not gain, and composed "more roll →
  more camber" from [[camber-gain]]'s "roll is what calls on it" — inverting a direction the same file
  states two paragraphs above. The full KB ships in context, so this was **not** a retrieval miss: an
  omission on one branch is read as "does not apply here", not as "left out for brevity".
  **Guard:** when a branch pair (`higher →` / `lower →`, `more` / `fewer`) lists consequences, both
  branches carry the SAME consequence set — no term appears on one side only. And where the pair moves
  a **rate** and the **multiplier that rate acts on** in opposite directions, say on the bullet that the
  net is not derivable, per COLLAPSED OPPOSING STRANDS below.
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
