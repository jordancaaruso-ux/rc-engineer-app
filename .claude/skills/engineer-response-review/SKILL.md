---
name: engineer-response-review
description: Reviewing Jordan's rated Engineer responses (the feedback inbox) and routing each problem to the right fix — KB draft, prompt change, data/context work, or calibration note. Use whenever he says "review the engineer feedback", "review the responses / the inbox", "analyze the ratings I just did", or pastes/exports rated Engineer answers and asks what's wrong. Report-only: this skill never edits the KB, the prompt, or code — it diagnoses and proposes. LIVING DOC: append new correction-patterns and rulings to the log at the bottom as they arise.
---

# Reviewing Engineer responses (feedback triage)

This skill exists because of one recurring failure: **misrouted fixes** — reaching for a prompt
rule ("never say stiffer rear adds rotation") when the real problem is that the physics is
missing from the KB. Jordan's 0–10 note on each answer IS the review; your job is not to
re-review the answer from scratch, it is to read his note with his values and route every
problem to the fix that actually belongs to it.

## Non-negotiables — read first

- **Report only.** No KB writes, no prompt edits, no code or backlog file changes. Propose;
  he dispatches. The only file this skill ever writes is its own correction log below.
- **Approved KB is founder-gated** (`AGENTS.md` hard rule 1) — even *proposed* KB fixes are
  worded as draft topics for him to approve, never as edits you're about to make.
- **`.env.local` is the live production DB** with real users. Read-only queries only, and only
  when a routing verdict depends on a fact you can't get from the export.
- **His note is ground truth for calibration.** When you honestly disagree — the physics was
  right, or the note misdiagnoses the root cause — say so openly in the report, labelled as a
  disagreement, with the physics argument and sources. Then route per his call anyway unless
  he changes it. A disagreement is data (often the start of a KB interview), not a veto.
- Never drive the app (`AGENTS.md`).

## The philosophy (what Jordan values)

- **KB-sufficiency principle — the core test.** The Engineer must be able to reason from the
  KB's physics alone to a great conclusion. If the KB as written cannot carry a sound
  symptom → mechanism → lever chain for the question asked, *the physics isn't good enough*,
  and that is a KB finding — even when the visible symptom looks like a model mistake.
  Rear-spring/rotation and front-toe-out/response were this: the KB was silent, the model
  filled the gap with generic full-size-car lore that is wrong for RC touring.
- **The prompt never carries physics.** A physics claim appearing in the prompt is proof of a
  KB gap. The prompt owns *behaviour*: which evidence to trust, ordering, hedging, length,
  presentation, subject discipline.
  - **Stopgap exception:** a recurring physics error may get a temporary prompt guard, but it
    must be explicitly marked as debt in the report and tracked in the stopgap register below;
    every review checks whether the KB now covers it and recommends deleting the guard.
- **Quantity vs actuator.** Reason and compare in the physical quantity; voice the change as
  the sheet knob the driver actually turns. Awesomatix springs: compare in **spring rate**
  ("68.4 vs 72.8 gf/mm — a bit soft"), recommend in **gap** ("add ~0.5 gap to firm it").
  Comparing gap medians is the failure ("gap 0 vs 3.1 median") — the same gap means different
  rates on different springs, so gap-space comparisons are physically meaningless.
- **Revert-first is fine — if labelled.** Undoing the most recent change is a legitimate
  cleanest-A/B first test. The failure mode is camouflage: reverting the last change while
  dressing it up as fresh symptom-driven advice. Recommending a revert must say "this reverts
  your 80→100 change — cleanest A/B", not pretend the median gap demanded it.
- **A median gap is a ranking prior, never evidence.** Distance from the community median may
  order candidate levers; it can never *justify* one. Justification is symptom → mechanism
  from the KB. "You're at 100 vs 60 median" as the whole argument = evidence misuse.
- **Uncommon combinations get named.** A suggestion that produces an unusual configuration
  (e.g. a 0.2 front/rear ARB split) can still be right — but the driver should be told it's
  uncommon so they can weigh it.
- **Setup is ART, not a fixed method** (same ethos as the KB-author skill): predictions are
  hedged, test-oriented, one-change-discipline; certainty language about outcomes is a smell.

## Inputs

- Primary: [docs/engineer-feedback/inbox.md](../../../docs/engineer-feedback/inbox.md) (+
  `inbox.jsonl`) — usually already filtered by him
  (`npm run engineer:export-feedback -- --limit N | --since D | --prompt-version V`; see
  [docs/engineer-feedback/README.md](../../../docs/engineer-feedback/README.md)). Review the
  file as given; don't re-export unless asked.
- Each entry: question, answer, his **note** (read it first), score, `kbSections`, run ids,
  and `promptVersion` on post-2026-07-30 answers.
- Entries with a score but no note: still classify, flag as **low confidence — no note**, and
  don't invent what he meant.
- Advice-turn reality check: full-tier answers ship the **entire KB** (approved + concepts +
  drafts behind a divider) as a system block — `kbSections` is a retrieval trace, not what the
  model saw. Don't diagnose "retrieval missed the file"; if the file exists and the model
  ignored it, that's prompt/evidence territory; if no file carries the mechanism, that's a KB
  gap. See [fullKbInContext.ts](../../../src/lib/engineerPhase5/fullKbInContext.ts).

## Method — per answer

1. **Read his note first.** It steers the review. Quote it verbatim in the report.
2. **Name the failure(s)** in one line each — what the answer did that earned the note.
3. **Run the KB-sufficiency test on every physics-shaped failure:** open the actual KB files
   (approved tier: [content/vehicle-dynamics/](../../../content/vehicle-dynamics/), concepts,
   then drafts) and ask: could a great chain for this question have been built from what's
   written? Name the files that should have carried it. Silence or a missing link = KB gap.
   A mechanism that exists **only in a draft** is still a KB finding (needs promote/verify),
   not a prompt finding.
4. **Verify load-bearing hypotheses before asserting them.** If the routing verdict depends on
   a factual claim about what the model saw — "damper % led because it was the changed key on
   runs near the anchor" — check it read-only (run change history around the anchored
   `runId`, the rating's context snapshot) instead of asserting it. Name in the report what
   was verified vs what remains a hypothesis.
5. **Route each failure into exactly one bucket** (below). One answer can produce findings in
   several buckets, but one finding never sits in two.
6. **Disagree openly where honest** — labelled, sourced, then route per his call.

## The five buckets

| Bucket | Test | Routed fix (proposed, never applied) |
|---|---|---|
| **kb-gap** | KB is silent or missing the link the chain needed | Propose the draft: file/slug, the mechanism chain it must contain, which feedback it fixes |
| **kb-wrong / conflict** | KB states something false, or two tiers disagree (draft vs approved) | Flag for his typed approval with both texts quoted — never edit, never pick a winner |
| **prompt / evidence misuse** | Physics was available; the model misweighted evidence or misbehaved (recency camouflage, median-as-evidence, unlabelled revert, quantity/actuator swap in presentation) | Propose the prompt diff in chat ([openaiEngineer.ts](../../../src/lib/engineerPhase5/openaiEngineer.ts)) and wait |
| **context / data gap** | The needed information wasn't in context at all (e.g. before→after values missing from the pattern digest) | Name the backlog item + the code seam it lives at |
| **calibration-to-Jordan** | Physically defensible, but not how he'd call it (style, aggression, what's worth mentioning) | Gold-set candidate note + log entry; explicitly *not* a KB or prompt change |

## Report format

Dot points, one line each (`AGENTS.md` comms style). Structure:

- **Per answer:** timestamp/score → his note (verbatim) → finding(s), each with bucket +
  one-line rationale + routed fix. Disagreements labelled `DISAGREE:` with the argument.
- **Batch synthesis:** cross-answer patterns (same lever leading multiple answers, same
  justification shape), score trend vs previous batch **by `promptVersion`** when stamped,
  anything the notes converge on.
- **Standing checks:** stopgap register audit (any guard now covered by KB → recommend
  deletion) · KB hygiene on files the findings touched (duplicate slugs, draft-vs-approved
  conflicts, stale roadmap rows) — flag only, never fix.
- **Prioritized fix list:** ordered by his severity (wrong physics quoted to a driver >
  evidence misuse > calibration > presentation), each item pre-routed so he can dispatch
  one-by-one.
- End by appending new patterns/rulings to the correction log below — the only write.

## Stopgap register (prompt guards carrying physics as debt)

- **2026-07-30 · `LOCK_TOE_GAIN`** ([openaiEngineer.ts](../../../src/lib/engineerPhase5/openaiEngineer.ts)) —
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
  derived rate, [springRateLookup.ts](../../../src/lib/setupCalculations/springRateLookup.ts)
  already derives it).

**2026-07-29 — "more front toe out normally delays initial steering though"**
- Pattern: PHYSICS FROM LORE again — [toe.md](../../../content/vehicle-dynamics/toe.md) and
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
