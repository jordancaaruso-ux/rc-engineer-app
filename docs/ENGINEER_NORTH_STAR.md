# ENGINEER NORTH STAR

Written fresh 2026-08-13, replacing everything before it. This is a **living document**: every
rule change to the Engineer lands here first, dated, in the changelog at the bottom. If code and
this document disagree, one of them is wrong — fix whichever it is, in the same change.

---

## 1. The bar

> **"I'd rather ask this Engineer than do anything else for setup advice or knowledge."**

Measured against every alternative: any book, any human expert, any other AI. Every change to the
Engineer is judged against this sentence and nothing else. Sub-goals, in order:

1. **Anyone, any skill level, gets a useful answer.** The novice gets a change to make; the expert
   gets the physics under it — from the same answer (see the layered shape below).
2. **No false confidence, ever.** One confidently-wrong answer to a fast driver costs more than
   ten bland ones. The undertone is always: *setup is an art — there are no guaranteed answers,
   and a change that doesn't work still tells us something.*
3. **Honest limits build trust.** Saying "that's outside my vetted physics" makes the confident
   answers more believable, not the product weaker.

## 2. The answer contract

The answer is shaped to the question, not to one fixed layering — no settings, no skill
profiles. The prompt (`src/lib/engineer/prompt.ts`) is the contract; this section describes it
and must never promise more than it sends. Founder call 2026-09-02: an earlier four-layer shape
(change / mechanism / what to feel for / when it wouldn't apply) is retired — people want to make
the car fast, and they ask when they want more.

- **A problem** ("it's loose on power"): the change and how far, one line, no preamble; where that
  change costs a part of the corner, the change that gets it back without touching the gain, one
  clause (since 2026-09-09); then two or three other levers, a line each — move, size, what sets it
  apart — so the driver can ask about any of them.
- **What a change does** ("what does more rear droop do"): the feel and where on the corner, in
  the nets' register — what the driver will feel, not what moves inside the car; other levers
  only if the Engineer would truly reach for them, at most two.
- **Why or how**: the mechanism, plainly.

A reason rides along only when it changes what the driver does, and only as a clause. A change is
described by what the driver will feel and where on the corner, never by what moves inside the car.

Rules that ride on the shape:

- **The KB is the whole of the physics.** Where it is silent the Engineer says so; it never fills
  in from general racing knowledge. Coverage is stated in words when it matters, never as a
  numeric self-rating — measured to be junk.
- **What the driver states is fact.** Their words become the problem — which end, where on the
  corner, how the grip behaves — and the lever is picked for that problem, never for wording that
  matches theirs.
- **At most one clarifying question per conversation, and only when the answer would change the
  change.** A request for information at the end of an answer counts as the question. For a
  two-answer knob with the corner unsaid, the one question is how long they are turning for and
  how quick. Otherwise the Engineer assumes the likeliest reading, says so, and answers it alone.
- **Contested lore gets both claims + the discriminator.** Where good-faith experts genuinely
  split (bar stiffness on low grip), state the majority line, name the minority line, and give
  the on-track observable that tells *this* driver which applies today. Never pick silently.
- **Never invent a number.** The only numbers allowed are the driver's own words, the KB, and the
  nets. When a question needs logged data the Engineer can't see, it says so plainly, then
  answers what physics alone can answer.

## 3. The knowledge architecture

Three artifacts, strictly tiered:

| Artifact | Contains | Bar | Home |
|---|---|---|---|
| **Physics KB** | Mechanisms — what a change does physically, never composed outcomes | Founder's "cannot be argued" test | `content/vehicle-dynamics/` |
| **Nets** | Empirical priors — "this change most likely feels like Y, and here's what flips/mutes it" | Probabilistic by design; AI-drafted from trusted sources, cross-checked against the KB, founder bulk-reviewed | `content/nets/` |
| **Driver data** | The driver's runs, setup, track, tyres — one run and its day, or a range of runs the driver chose | Facts, not instructions — plain statements only, v0-lab lineage; shipped 2026-08-25 ahead of harness calibration (changelog); the arithmetic (tyre-run deltas, day movement) is done in code, never left to the model | `src/lib/engineer/driverData.ts` (a run), `src/lib/engineer/driverHistory.ts` + `historyShape.ts` (a range) |

Nets are **change-first** (the transpose of every symptom→fix guide), in RC-canonical
coordinates: corner phase × on/off power × end of car. Modifiers are first-class and may
**reverse** an effect, not just scale it — most famous forum contradictions are one unstated
modifier (the value of chassis roll flips sign with grip level). Genuinely unresolved effects are
marked `contested` and carry both claims plus a discriminator. Schema and authoring rules:
`content/nets/README.md`.

**The payload** (`src/lib/engineer/payload.ts`) is ordered blocks: KB first, nets second, prompt
third, per-turn material last, conversation at the end. Cache-stable blocks precede per-turn
blocks — **enforced in code, not convention**; a violation throws. The system prompt stays under
~10 behavioral rules, each mechanically checkable; the KB and nets enter as documents, never as
instructions. `DEBUG_ENGINEER_WIRE=1` dumps the exact request — the audit instrument; never
reason about the payload from source alone.

## 4. The evaluation constitution

Nothing ships on taste. The harness is `scripts/engineer-eval/`; measurement comes before any
prompt, payload, model, or knowledge change.

**Ground truth is Jordan.** Blind pairwise ratings (A/B, order-randomized, one-line reasons) on a
seed set of ~40–60 questions stratified by archetype — including trap questions (wrong premise,
"change nothing" is correct, needs-data, out-of-corpus) because traps are what separate a judge
from a politeness meter.

**The physics gate runs on every answer and has no taste.** Claims are extracted and checked
against the KB + nets: *contradicted* = auto-fail, logged with the claim and passage;
*not-in-KB* = logged, never failed. The gate is a separate program from the preference judge, so
iteration can never charm it.

**The AI judge is a calibrated copy of Jordan's taste, and its quality is a number.** Built from
a rubric extracted from his rated pairs (expect criteria drift — rewrite it as he discovers his
real criteria) plus 8–15 rated pairs as worked examples. Different model family than the
Engineer; every pair judged twice with order swapped, disagreement = tie. It then sits an exam:
~50 frozen Jordan-rated pairs it has never seen, scored with Cohen's κ. Jordan's own re-rate
consistency (~10 pairs re-shown weeks later) is measured first — that is the ceiling.

| Exam score | The judge may |
|---|---|
| κ < 0.6 | Do nothing. Rework the rubric, retake the exam. |
| κ ≥ 0.6 | Steer experiments between Jordan sessions — every conclusion still audited before acting. |
| κ ≥ 0.75 | Gate ship decisions without Jordan in the loop. |
| any | Never override the physics gate; never be the sole evidence for a ship. |

The frozen holdout never trains the judge. The exam is re-sat after every judge change.

**Goodhart guards, always on:** a winning variant >20% longer than the loser → suspect the judge
before believing the win; after 2–3 tuning rounds against one judge version, Jordan blind-rates
fresh pairs — judge claims improvement he can't see → the judge has drifted, re-anchor; with a
50-question set, only splits ≥65/35 beat coin-flip noise — smaller "wins" are noise and are not
shipped.

**Honest limit, stated out loud:** one rater is below the published multi-annotator floor. This
harness deliberately builds "what would Jordan say", not "what is true" — his taste is the
product. The physics gate is the only component anchored to something other than one person's
taste, which is why it stays independent.

## 5. What the Engineer is not

Each of these was deleted or declined for a reason. They return only through the harness, if at all.

- **Not a suite of satellites.** Quick-fix, between-run hints, dashboard suggestions: deleted
  2026-08-13. The Engineer is chat. Anything ambient must be reborn from the new core and beat
  the bar.
- **No skill profiles or depth settings.** Users can't self-assess skill; the layered answer
  shape serves everyone without asking.
- **No retrieval machinery.** The KB is ~14K tokens and rides whole in every request. Retrieval
  returns only if the corpus outgrows the context budget, measured, not assumed.
- **Driver data ships as facts, never instructions.** Since 2026-08-25 every turn carries the
  driver's latest session, its setup, and the nearest earlier runs as per-turn blocks
  (`driverData.ts`) — plain statements of what is true, nothing about how to think. The
  prompt sentence that once denied data exists now draws the line around exactly what is
  attached, and it is still load-bearing.
- **No tools, no choice chips, no status theatre.** The old pipeline grew to ~99K
  chars a turn one reasonable addition at a time; the payload-contract test exists so additions
  fail loudly instead of accreting. The one switch the driver holds is the subject bar:
  Auto reads the latest run, a pin reads a chosen run, a **range** reads the runs the driver
  named (a track, a car type, a span of dates — since 2026-09-14), General attaches no run.
  The range is always the driver's choice, never inferred from the wording of the question:
  the Engineer has no tools and cannot query the log, so the app attaches exactly what was
  named and the block says what is and isn't in it.
- **No unmeasured ships.** A change to prompt, payload, model, KB tiering, or nets rendering
  ships only on: physics gate clean, harness win ≥65/35 (or judge-gated at κ≥0.75), and a Jordan
  blind audit for anything user-visible.

## Changelog

- **2026-09-15** — Founder call, round 03: a group's knobs are named together when nothing the driver
  said separates them ("more front roll stiffness — a step on the spring or 0.1 mm on the bar"), with the
  one carrying the least cost first. Nets header only; label `2026-09-15-group-move`. No family rule for
  "lazy into the fast stuff" — refused as a static rule.

- **2026-09-14, night** — Founder call: "I'd want to be able to compare to individual drivers."
  Both blocks now carry a RIVALS summary whenever any run has a field (the drivers who shared the
  most timed sessions, your average best-lap and top-5 gap to each, how often you were quicker),
  and a driver NAMED in the question gets a VS section: every shared session with both drivers'
  best and top 5 and the gaps, the clean averages, a line per day. Names come off the timing
  sheets; the match is by surname with typos forgiven (`matchDriverName`), a shared surname needs
  a first name. A session with a cut lap on either side (a best lap implausibly under that
  driver's own top-5) is shown, marked, and left out of every average. The latest question now
  rides into both block builders for this; nothing else reads it. `rivals.ts` is pure and tested.

- **2026-09-14, evening** — Founder call: "does engineer use relative laptimes to everyone else?
  that would be where the real value is." It did not. Now every run in both driver-data blocks
  carries **vs field** from the timing sheet it was imported from (`fieldPace.ts`,
  `fieldPaceLoad.ts`): place by best lap out of the timed entrants, best lap minus the fastest
  driver's (0.00 = fastest), the same for the top-5 average, best minus the field's average best.
  The filter block adds a TYRES, AGAINST THE FIELD table (the tyre deltas measured as gap to P1,
  which cancels the day because the field aged its tyres and felt the track move too), a BEST
  RUNS, AGAINST THE FIELD ranking, and a "gap to P1 vs previous run" figure on every changed /
  unchanged line (allowed to cross days, unlike the tyre-corrected one). "You" is picked off the
  sheet the race-field view's way: saved primary name, then lap-for-lap match, then the parser's
  first row. Read-time uses STORED field stats only; `npm run db:backfill-field-stats` fills the
  sessions imported before stats existed (scratch-dev: 702 without → 159 gained a field of 2+,
  538 older imports hold only the driver's own laps and cannot). Production still needs that
  backfill run. Sign convention throughout: you minus them, positive = slower.

- **2026-09-14, later** — Founder calls on the first pass. (1) "Range" is **Filter** on the bar and
  in the URL (`mode=filter`). (2) A **meeting** is a filter in its own right: `eventId` on the
  scope, resolved server-side to the event's runs plus its track on its declared days; the run
  picker lists the driver's meetings above their runs, and the filter picker leads with them.
  (3) "If I say 'search sa state titles' can it not just look for that by itself … it needs to
  interpret errors a bit": before a question is sent, its words are matched against the names
  of the driver's OWN meetings and tracks (`nameMatch.ts` — edit distance, one slip on a short
  word, two on a long one, a year in the message picks that year's meeting, four-letter names
  exact only). A hit becomes the filter for that question and the bar switches to show it; never
  in General. No model, no tools, nothing inferred beyond a name the driver typed. (4) After the
  Engineer correctly did twenty subtractions itself to rank SA State Titles runs by tyre age,
  the block now carries **new-tyre equivalent** figures: each run line's best / top 5 with the
  TYRES table's average loss for that tyre run taken out, the same delta on every "changed" and
  "no setup change" line against the previous same-day run, and a BEST RUNS, NEW-TYRE
  EQUIVALENT top five. The model reads them; it no longer has to make them. Also: a "run 1"
  inside an existing stint splits the set (production had a morning on runs 5–7 and new rubber
  at 11:42 under one stint id).

- **2026-09-14** — Founder call: "ask the Engineer to look at lap times from a certain track or
  set of dates … what the delta is in lap time from new tyre to second run to third run". The
  subject bar gains a fourth state, **Range** — a track (or all), a car type (or all), a span of
  dates (or all time) — and the route attaches a range block (`driverHistory.ts`, shaped by
  `historyShape.ts`) *instead of* the run block: one line per run (date, clock, session, best,
  top 5, five-minute stint, laps, rating, tyre run, compound, air and track temperature, what
  changed on that car's sheet), a DAYS table (best of day, first-to-last movement, air), a
  TYRES table (one line per set of rubber with two or more timed runs, every run's delta
  against run 1 on that set, the across-set averages for run 2..5 vs run 1, same-day pairs
  separated because a set that spans days carries a day's grip change in its delta), and the
  sheet on the car at the last run shown. Capped at the most recent 60 runs; the block says
  how many older ones it left out and that nothing outside the range is attached. Every delta
  is computed in code and signed the app's way (positive = slower) — the prompt's "never invent
  a number" now covers subtraction across forty laps. Starter questions gain a `range` family
  (tyre deltas, best run here, getting faster, changes that worked, morning to afternoon, pace
  vs air). The prompt is unchanged. Eval: `questions/range-set.json` against a captured real
  render (`capture-range-fixture.ts`). This reopens, deliberately and on founder call, the
  history work parked on 2026-09-09; the "car's life" document and drift-corrected pattern
  finder stay parked — the range block prints facts and arithmetic, it finds no patterns.

- **2026-09-09** — Founder call, from round 01 of the launch review: a change can need a second
  change to show its worth. The physics went on `corner-regime.md` first ("Two changes can share one
  test") and moved no answer; the shape now carries the slot — where the lead change costs a part of
  the corner, the change that gets it back, one clause, conditional on a cost. Label
  `2026-09-09-paired-changes`. Same day, in the knowledge base rather than the prompt: a corner named
  is a phase given (hairpin = the middle), and a change that made the car worse everywhere sends the
  same lever the other way first; whole-car moves render as BOTH ENDS TOGETHER lines on their family's
  GROUP heading, derived from the KB's own links.

- **2026-09-03** — Founder call: the Engineer page wears its 1 September look again (starter
  questions, two cards) over the rebuilt mind, and the subject bar returns with three honest
  states. Auto and a pinned run are the `runId` `driverData.ts` already honoured; **General** is
  new on the wire only as a flag (`mode: "general"`) that skips the driver-data blocks — the
  request a driver with no runs has always received, so no new payload shape. Setup pins, event
  pins, compare pairs and the choice chips stay deleted: the mind reads none of them. Shipped on a
  founder call, measured after, as on 2026-08-25.

- **2026-09-02** — §2 rewritten to describe the prompt as it ships (label
  `2026-09-01-rc-direction-guard`), by founder call after a whole-system audit found the doc
  promising a four-layer answer (change / mechanism / what to feel for / when it wouldn't apply)
  and three coverage-confidence levels that the wire had not sent since the 2026-09-01 cuts. The
  prompt is the contract; this document follows it. The 2026-08-27 → 09-01 prompt history lives
  in the doc comment on `ENGINEER_PROMPT_LABEL`.

- **2026-08-25** — Founder call: ship the rebuilt Engineer to production ahead of harness
  calibration, then iterate. Three changes land together: (1) the nets enter the shipped
  payload (16 AI-drafted touring entries in the drafts tier, rendered behind the hedge
  divider until founder review promotes them; Invisible Speed transcripts become the primary
  drafting source, README amended); (2) driver-data blocks ship for every user — latest
  session + setup + comparable runs, the v0 lab's fact blocks promoted from admin-gated to
  always-on; (3) prompt label bumps to `2026-08-25-live`, a new ratings baseline. §4 is
  deferred for this ship, not repealed: the calibration session, judge exam and ship bar
  still govern every change from here, and the first calibration run doubles as this ship's
  retrospective measurement.

- **2026-08-13** — Document written fresh; everything prior deleted. Ground-up rebuild: new core
  at `src/lib/engineer/` (block payload, enforced cache order), satellites and old docs/bench
  deleted, prompt version label `2026-08-13-rebuild` starts a new ratings baseline (old scores
  incomparable). Interview decisions and research basis: see the rebuild plan in the repo
  history and `content/nets/README.md`.
