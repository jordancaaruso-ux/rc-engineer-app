# Engineer response corrections — observation log

What the Engineer actually got wrong, dated, in Jordan's words where quoted. Extracted from
the engineer-response-review skill on 2026-07-31 when that skill was deleted: the methodology
around it was instruction, this is observation. Seed the rebuilt eval from here and from
inbox.jsonl — not from predicted cases.

The stopgap register below is the live debt list for the LOCK_* prompt guards.
## Stopgap register (prompt guards carrying physics as debt)

- **2026-07-30 · `LOCK_TOE_GAIN`** ([openaiEngineer.ts](../../src/lib/engineerPhase5/openaiEngineer.ts)) —
  RETIRED TO POINTER SAME DAY: both signs (rear: fewer = more gain; front: more = more bump-in)
  are founder-confirmed and live in approved `bump-steer-toe-gain.md` "Sign" lines; the lock
  now points at the KB and keeps only the anti-reversal warning. Delete entirely once a
  ratings batch shows no shim-direction reversals.
- **2026-07-30 · `LOCK_DAMPER_OIL`** — direction (thicker = more damping) already lives in
  approved `damper-oil.md` + `concepts/damping.md`, so this lock is redundancy against an
  observed reversal, not a KB gap. Review each batch: when reversals stop appearing, propose
  slimming it to a pointer.

_Both locks were added by a parallel session on 2026-07-30; listed here so every review
audits them per the stopgap rule._

## Correction log (LIVING — append new patterns, newest first, with date)

**2026-07-31 — third batch (8 ratings, 2026-07-30 22:21–23:51 UTC, all `2026-07-30b+17619acd`; mean 5.9):**
- **UNLOADED-WHEEL FALLACY — the batch's root pattern, two answers, one cause.** The model reasons
  about the wheel that is *pointed* at the corner instead of the wheel that is *carrying load*.
  Front toe-out ("reduce toe-out for smoother turn-in") and Ackermann ("more Ackermann for hairpin
  steering") both fail this way. Once lateral load has transferred, the inside front is nearly
  unloaded — angle changes there mostly scrub; the loaded outer governs response.
- **APPROVED-TIER CONFLICT #1 — `concepts/toe-and-scrub.md` first-instant paragraph** (promoted
  ef07a30, 05:20 UTC, before all 8 answers) says with toe-out "the inside wheel already points
  toward the corner and builds its slip angle first". Jordan, third time now: "more negative is
  smoother", "more front toe out normally delays initial steering". The model followed approved KB
  and still got his sign wrong — this is no longer a kb-gap, it is a **kb-wrong/conflict awaiting
  his typed ruling**. Reconciliation to put to him: the first-instant inside wheel carries little
  load, so its early slip does little; toe-out points the *loaded* outer wheel away, so response
  builds later = smoother.
- **APPROVED-TIER CONFLICT #2 — hairpin regime.** `concepts/corner-regime.md` classes a hairpin as
  transient ("fails the second test… brake, apex and throttle keep the loads moving"); his note says
  "for hairpins you would want more steady state, not transient. Something about our steady /
  transient theory isn't working together well". But 64 min later he scored 7/10 and agreed with an
  answer that treated hairpins as transient (stiffer rear flex → less rotation in hairpins). Both
  can hold if a hairpin has a transient entry and a steady mid-phase at lock — needs his one-line
  ruling before any KB move, because corner-regime is load-bearing for most balance answers.
- **"GENERAL VEHICLE-DYNAMICS THEORY" AS A LICENCE.** On rim/wheel stiffness (KB silent) the model
  answered confidently and labelled it "general vehicle-dynamics theory, not confirmed on every
  touring car". His note: "Is this actually general vd knowledge?" The hedge laundered lore as
  established theory — prompt needs "KB silent → say the KB is silent", distinct from an inference
  hedge. Same shape as PHYSICS FROM LORE, but with a hedge attached, which is why it passed.
- **INVENTED METRIC.** "loses the first 3–5 lap pace" — the app computes avgTop5 / avgTop10 /
  avgTop15 / consistencyScore (`computeLapOutcomesForEngineer.ts`); there is no first-N-lap metric.
  Rule (12) forbids invented *causes*; predictions may still invent *measurements*. Extend
  PREDICTION DISCIPLINE: what disproves a change must be observable by the driver or computed by
  the app.
- **PROMPT-PRESCRIBED VOCABULARY REJECTED.** `LOCK_VOCABULARY` (openaiEngineer.ts:258) and the
  on-in-track rule (:377) both instruct "more rolled-in"; his note: "'rolled in' isn't a thing".
  Also rejected: "pair share load better" (a garbled compression of tyre-load-sensitivity),
  "rotate more before the rear fully takes a set" (wants "rotate for longer"), "sharper load
  timing / cleaner response" (too vague), "less clean" (wants "less predictable"). The prompt is
  the source of one of these, so this is a clean prompt fix, not a model slip.
- **BREVITY REWORK HELD.** Zero length complaints across 8 answers (previous three batches all had
  one). The notes moved up the stack to vocabulary and physics — treat `2026-07-30b` as landed on
  length, and do not trade terseness back for it.
- **RECENCY CAMOUFLAGE ABSENT.** Damper % led no answer in this batch (one caveat mention only)
  after leading 3 of 4 two batches ago. Rule 14's lead-lever phase fit looks to be working.
- Register: `LOCK_TOE_GAIN` — rear sign quoted correctly ("fewer shims = more toe-in gained",
  23:51), no reversal; keep the pointer. `LOCK_DAMPER_OIL` — oil not discussed in any of the 8,
  no evidence either way; keep.
- Method note: `--since today` exported 8 and overwrote the inbox; the four 07-29 ratings and the
  two 07-30 morning ones are no longer in the file. Re-export unfiltered if older entries are
  needed.

**2026-07-30 — OVER-EXPLANATION, third occurrence — now an implemented prompt rule, not a note:**
- Founder, on a general-mode lever survey (rear-exit levers: RC, toe/gain, diff, anti-squat,
  damping, travel limits, each with its own both-ways paragraph plus a closing symptom→group
  map): "all of this stuff is over explained a little still - if it were me id want shorter more
  precise info, if i want more info i could ask to expand". Chat-only feedback — no DB rating.
- Diagnosis worth keeping: **rule (3) inflates length structurally.** Honest both-ways framing is
  cheap on one lever and ruinous across six — the survey shape, not the hedging, is the fault.
  General mode also lacked the full prompt's "lead with the single highest-leverage move" line,
  so nothing capped the lever count there.
- Implemented (prompt only, `2026-07-30b`): CHAT_SYSTEM "say it once, then stop" bullet ·
  CHAT_SYSTEM_GENERAL BREVITY block (one or two levers, one line each, rule 3 costs a clause not
  a paragraph, ask-one-question instead of covering every branch) · rule 14 expectation-question
  bullet with the cross-axle and question-framing failures named · bite/hold vocabulary added to
  LOCK_VOCABULARY.
- Deliberately NOT built: a "dig deeper" chip after every answer (his earlier idea). Chips are
  reserved for one clarifying question; a per-reply expand button is a UI decision he should make.
  Route: if brevity lands but he still wants the affordance, it is a UI item, not a prompt one.
- Watch next batch for the overshoot: terseness that drops the expect / if-wrong prediction, or a
  single lever offered where the honest answer is "two things could do this".

**2026-07-30 — second batch review (2 ratings, 07:09 + 07:37 UTC, first `promptVersion`-stamped batch `2026-07-30+c8b5aee3`):**
- **REAR-TRANSIENT SIGN INVERTED *AFTER* PROMOTION — the recurring stiffer-rear→rotation pattern
  changed bucket.** `concepts/corner-regime.md` was approved-tier at answer time (promotion
  commit 05:20 UTC precedes both answers; the stamp code shipped in the same push), and the
  07:37 answer demonstrably read it (used "transient" / "samples more of the early/transient
  behaviour"), quoted its premise ("rear takes load sooner"), then inverted the conclusion:
  claimed stiffer rear → "sharper initial rotation" in hairpins where the file says it "resists
  yaw from the first steering input". Same thread had stated the correct sign 28 min earlier
  (07:09: softer rear → yaw develops entry-to-apex). The sign flips to match the question's
  framing. Bucket is now **prompt/evidence misuse**, no longer kb-gap — stop routing this to KB.
- **Jordan's note = the KB's own mechanism.** "If the rear had more initial grip it should be
  planted in the rear sooner?" is corner-regime's transient chain verbatim-in-spirit; his mental
  model and the approved file now agree. This effectively closes the first batch's
  NOTE-vs-DRAFT CONFLICT (and he promoted the file himself).
- **EXPECTATION QUESTIONS ESCAPE RULE 14.** "What should I expect from X in corner-type Y" is
  not a recommendation, so the lead-lever phase-fit bullet never bound; regime placement must
  govern predictions too. Prompt extension proposed, awaiting approval.
- **Ungrounded feel words where bite/hold vocabulary exists** ("too immediate", "skatey") — his
  note asked "what is 'too immediate'"; `concepts/bite-hold.md` carries the intended frame.
- Landed fixes observed working: rate-vs-gap done right (compared in gf/mm, gap treated as
  actuator, correctly reported no usable spread for the gap row); no median-as-justification.
- Register: no toe-gain or damper-oil reversals in batch (n=2, neither lever discussed — weak
  evidence); both locks kept.

**2026-07-30 — drafts audit (founder-delegated: "is this physics that cannot be argued?"):**
- Founder's articulation of the KB's purpose, verbatim: "the kb is the physics, its the
  knowledge that will allow the ai to reason to a great answer, not be given an answer." The
  audit test for every KB line: unarguable mechanism = keep; tendency, probability, coaching,
  symptom→knob recipe, lever ranking = cut or route to his ruling.
- Applied 2026-07-30: coaching/recipes stripped from awesomatix (pack outcomes), servo-horn
  (darty→shorter recipes), shock-geometry ("advise as a test" tails), upstop (springs-first
  lever ranking), track-width (duplicated mechanism paragraph). corner-regime untouched
  (founder: "great … dont change drastically"). front-toe-response-timing DISSOLVED into
  approved concepts/toe-and-scrub.md per his instruction — no standalone docs for physics that
  extends an existing node.
- Structural ruling: new physics goes onto the node where that physics already lives, never a
  new file, unless it is a genuinely new concept.
- Open rulings still owed: bite-hold slug conflict. RESOLVED same day: pack direction (higher
  damper % = fewer holes = more pack, Awesomatix-specific — in the awesomatix draft) and rear
  toe-gain sign (fewer shims = more gain — in approved `bump-steer-toe-gain.md`).

**2026-07-30 — TRANSCRIPTION TRAP (founder correction on the dispatch itself):**
- I wrote his spoken hedge ("probably more so in higher grip") into a KB draft as an outcome
  claim. His correction: KB carries physics that can't be argued; probability phrasing is
  arguable by construction. Rule for this skill's KB-route proposals: propose the MECHANISM a
  founder statement implies, check whether the node already carries it (here it did — the
  Low grip section), and quote his words only in banners/logs. Full pattern logged in the
  kb-author skill's correction log.
- Draft promotions are ON HOLD until he reads all drafts — he asked for the full read-through
  before approving anything.

**2026-07-30 — dispatch rulings after the first batch review:**
- Steady-state rear strand RULED: stiffer rear *can* free the rear in long fast sweepers, more
  likely in higher grip, but weakly predictable — hedge-and-test language only, and never offer
  it in hairpin/flick questions. Hedge written into `drafts/corner-regime.md`.
- Rear toe-gain sign RULED: fewer shims = more bump-in on this platform, other cars can be
  opposite — KB line proposed for `bump-steer-toe-gain.md`, awaiting typed approval; retires
  half of `LOCK_TOE_GAIN`.
- Quantity-vs-actuator IMPLEMENTED in data: `spring_gap_*` spread rows now carry current value
  only (no bands/median/positionBand) — `setupSpreadForEngineer.ts`; rate rows do the comparing.
- Prompt rule (14) ADDED (lead-lever phase fit · medians rank never justify · reverts labelled).
- Toe-out timing: web scour SPLIT — manufacturer tables assert "toe-out = more entry steering"
  with no mechanism; Savoya + load-transfer literature support the founder's outer-wheel
  mechanism for the loaded phase. Drafted as `drafts/front-toe-response-timing.md` (two-phase
  framing).
- Rule 13 (parallel session, same day) revealed the 22:41 "add punch" note was written about an
  FDR change and re-attributed to damper % — sharpens RECENCY CAMOUFLAGE: check what a note was
  actually about before accepting the model's attribution.

**2026-07-30 — first batch review (4 ratings, 2026-07-29 22:36–22:46 UTC):**
- **DAMPER DEFAULT refined:** damper % led 3/4 again, but Jordan called the 22:36 lead "great"
  and doubted the 22:39 one — same lever, same median citation. The discriminator is
  **mechanism–symptom fit**: entry response is a transient symptom (damping's KB domain per
  `concepts/damping.md`); steady on-throttle wander is not ("does nothing once roll is
  constant"). The prompt fix is never "stop suggesting damper %" — it is "lead lever's
  mechanism must match the symptom's phase/regime; median only ranks".
- **LABELLED REVERT done right in the wild:** 22:41 said "undoing the damper-percent move…
  cleanest retest of the last change" — exactly the sanctioned form. DISAGREE (severity) with
  the note filed openly; residual fault was median-as-corroboration only.
- **NOTE-vs-DRAFT CONFLICT (pending Jordan's ruling):** his note "still suggesting stiffer
  rear spring for rotation — even through a long corner" vs `drafts/corner-regime.md` lines
  28-32, which scope stiffer-rear→more-steering to long, HIGH-SPEED steady-state corners
  (Xray-sourced). Ambiguity: if his "long corner" means long-duration hairpins, the draft
  already agrees with him (hairpins fail the steady-state test). One-line ruling needed
  before the draft can be promoted or corrected.
- **NEW kb-gap beyond his notes:** the model asserted the A800RR platform sign "fewer rear
  toe-gain shims = more bump-in" twice across batches; `bump-steer-toe-gain.md` deliberately
  states no sign ("measure, don't count shims"). Founder-confirmable fact; if the sign is
  wrong the advice inverts.
- promptVersion absent on all four (pre-stamp answers) — version-keyed trend tracking starts
  next batch.

**2026-07-30 — interview rulings (the skill's founding calibration):**
- Boundary: prompt never carries physics; recurring errors may get a *labelled, tracked*
  stopgap guard, deleted once the KB covers the ground.
- Quantity-vs-actuator ruling (spring gap): compare in rate, recommend in gap; gap-median
  comparisons are the failure, not the word "gap".
- Revert-first ruling: reverting the last change is a valid first test **when labelled as a
  revert**; camouflaging it as fresh symptom advice is the failure.
- Disagreements: push back openly in the report, then route per his call.
- Verification: check load-bearing evidence hypotheses read-only before asserting root cause.
- Output: report-only; his note is read first, not blind.

**2026-07-30 — "he still likes saying stiffening rear spring adds rotation" (repeat, 2 batches)**
- Pattern: **PHYSICS FROM LORE** — KB silent on spring↔rotation direction, model fills with
  full-size-car intuition, wrong for RC touring steady-state corners. Bucket: kb-gap (the
  corner-regime / bite-hold drafts were written for exactly this; still unpromoted). Stop
  believing this is fixable from the prompt.

**2026-07-30 — "he loves suggesting damper %" / "he did the 'add punch' again" (3 of 4 answers)**
- Pattern: **RECENCY CAMOUFLAGE** — the lever that changed on runs near the anchor gets
  recommended for unrelated symptoms, justified by a median gap. Bucket: prompt/evidence
  misuse. Fix shape: recency may inform diagnosis and *labelled* reverts, never justify a
  fresh recommendation; median gap ranks, never justifies.

**2026-07-30 — "Spring gap is misleading — just use spring rate"**
- Pattern: **QUANTITY/ACTUATOR SWAP** — comparisons quoted in actuator space (gap medians)
  instead of quantity space (rate). Bucket: split — presentation rule is prompt; but note
  aggregations/spread expose gap keys, so a full fix may also be a data item (compare in
  derived rate, [springRateLookup.ts](../../src/lib/setupCalculations/springRateLookup.ts)
  already derives it).

**2026-07-29 — "more front toe out normally delays initial steering though"**
- Pattern: PHYSICS FROM LORE again — [toe.md](../../content/vehicle-dynamics/toe.md) and
  `concepts/toe-and-scrub.md` make no claim about toe-out vs initial response timing; model
  asserted the generic "toe-out = sharper entry". Bucket: kb-gap.

**2026-07-29 — "a bit odd to consider an arb change that results in a .2 split… user would want to know its not that common"**
- Pattern: **UNNAMED ODDITY** — uncommon resulting configuration not flagged to the driver.
  Bucket: calibration-to-Jordan (the suggestion itself was defensible).

**2026-07-29 — "response is a little long and dragged out… if i want more info i can ask"**
- Pattern: length/fluff — prompt (presentation). Largely improved by the next batch; don't
  over-correct into terseness that drops the expect/if-wrong test framing he does want.

**2026-07-22 — weekend review "needed to reference specific setup changes a little bit more"**
- Pattern: **DIGEST WITHOUT VALUES** — pattern digest carries changed key names, not
  before→after values, so recaps can't quote the actual moves. Bucket: context/data gap
  (`patternDigestTypes.ts`).
