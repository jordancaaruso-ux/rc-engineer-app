# Engineer Suggestion Quality — the plan

**Status:** Draft for founder review (2026-07-08, rev 2). **Owner:** Jordan.

The method for getting the Engineer to the best possible setup suggestions, worked out
from first principles across three agent review rounds (2026-07-08). This doc extends —
never overrides — `ENGINEER_NORTH_STAR.md` (behavior contract) and `AGENTS.md` (KB
gates). Where this doc and the north star disagree, the north star governs until Jordan
reconciles them.

**Rev 2 core correction:** rev 1 crowned the symptom taxonomy the keystone by logic
("diagnosis precedes everything") while the only hard number we have — gpt-5.5 at
9.0/10, zero failure tags, prose-only — suggests frontier models already diagnose well
over prose and the measured weakness is more plausibly *calibration*. This plan now
applies "numbers first" to its own ranking: **the failure distribution decides which
keystone gets the next month**, not an argument.

---

## Session findings & revised direction (2026-07-08)

**Read this first — it revises the plan's premise.** Step 1 was built and run; the numbers moved the target. Where this section and the analysis below conflict, this is newer.

### What we built + measured
- **Step 1 + 2a tooling shipped (all tested):** failure-class tagging (`src/lib/engineerFeedback/failureTaxonomy.ts` + rubric-decomposed `failureClassifier.ts` with **coverage attribution** — splits reasoning failures from KB gaps so an incomplete KB can't inflate the misdiagnosis count) · `engineer:bench:failures` report · differential-grounding metric (`groundingDivergence.ts`) + `engineer:bench:grounding` sweep (`--list-runs` curates fixtures from real runs) · claim-ID schema (`src/lib/engineerPhase5/kbClaims/`, dormant + gated). ~40 tests across the new modules.
- **Both pre-nominated keystones RULED OUT on the shipping model (gpt-5.5).** Failure classification over 30 crafted/gold cases: **misdiagnosis 0/30, miscalibration 0/30, 0/7 on confidence traps.** The diagnosis keystone and the confidence-cap keystone target failures gpt-5.5 doesn't measurably have. (gpt-4o for contrast: genericness-dominant, 63% no-prediction — the model gap gpt-4o→gpt-5.5 is **5.9→9.0**, still the biggest lever ever measured.)
- **Differential grounding killed the "genericness" alarm.** The bench answered every case against ONE context (the founder's latest run), so genericness was unmeasurable. Running the same question across **5 contrasting run contexts** scored **0.89–0.97 divergence** — the model gives genuinely different, setup-specific answers (each citing that context's actual out-of-range parameter + a different lever). The earlier "genericness" signal was largely a **single-context artifact**, exactly the founder's hypothesis.
- **Production mining: the flywheel is empty.** Only **3** rated in-app answers exist (`EngineerMessageRating`), and they predate gpt-5.5. We cannot yet measure the shipping model on real inputs — the moat metric (acted-on × outcome) has no data yet.

### The target, redefined (founder, 2026-07-08) — DO NOT lose this
"No gross failures on an easy set" is the **floor, not the goal**, and the judge saturates at 9/10 so it can't tell good from best. **The goal is the best-possible suggestion, pursued relentlessly — not the absence of failure.** "It diagnoses fine" is explicitly the wrong bar.

A **10/10 suggestion** is ALL of:
- the **optimal** lever for this exact context — not merely a safe, reasonable one;
- correct **aggregation judgment** — reads where the setup sits vs the field AND **decides when to move toward vs further from the median**. *The median is NOT a target;* some of the founder's best moves went further out — treating the median as a gravity well is itself a failure mode;
- **teaches / earns trust** — reasoning clear enough to build the driver's own intuition;
- a **checkable prediction** — what to feel + what would disprove it.

**Aggregation trust is conditional (founder's sharpest point):** sparse cars have few comparison setups, so the aggregation may be noise. A great answer knows **how much data backs the number** (sample size) and **discounts thin aggregations** rather than anchoring to a median built from ~5 setups.

**Test-matrix axes (founder-ranked):** aggregation **position** × aggregation **data density** × handling **symptom** × **grip/conditions**. (Car/discipline later.)

**Suspected weakest:** connecting runs across a day/weekend (weekend-arc reasoning) — but "hard to say," so the eval must **hunt**, not assume.

**Improvement engine = all four, not one:** founder ratings calibrate a judge that gates changes · blind A/B on prompt/context variants · adversarial hunt for weak contexts · expert (top-human-engineer) benchmark.

### First quality fix shipped — aggregation density
Trace of how aggregation reaches the LLM (`setupSpreadForEngineer.ts` → `engineerRichContext.ts` → `openaiEngineer.ts`): median-is-not-a-target ✓ and `positionBand` checks ✓ are already in the prompt, but three real gaps: (1) it was **never told to weigh a band by how many setups back it**; (2) the one hook (rule 10) referenced `totalRunCount`, a field the slimmer **nulls out of context** — a dead check that never fired; (3) `sampleCount` is **stripped from the graded-lever / intent surfaces** the model decides on in lock mode. **Fixed in `openaiEngineer.ts` CHAT_SYSTEM:** new **rule (12)** — weight community bands by `spread.sampleCount`; ≤~6 setups ⇒ weak hint, don't anchor, and "moving away from a thin median isn't going against the field, because there is barely a field" — plus a stance line (177) and the rule-10 dead reference removed. Threshold (≤6) is tunable. **Still open:** surface `sampleCount` on `gradedLevers`/`parameterIntentMatches`/`gripTrendSignal`; mirror to the dashboard suggestion payload; **A/B-measure rule 12 on thin-N cases** (not yet done — ship-then-prove per the improvement engine).

### Revised sequencing (supersedes the table below where they differ)
1. **Measure real + cold** (founder-chosen next step): a true cold/thin-history fixture needs a synthetic no-history user; production mining is blocked until ratings accumulate → also argues for instrumenting the rating flywheel.
2. **Build the improvement engine** (all four mechanisms) — now the spine: relentless best-possible needs an instrument that discriminates *at the top* across the position × density × symptom × grip matrix.
3. **Aggregation-judgment eval** — fixtures spanning position × density; test toward / away / ignore-thin-data explicitly (the founder's #1 axis).
4. **Shelve** the diagnosis layer, confidence cap, and claim atomization (steps 2a–5) as solving non-problems on the frontier model — revisit only if real-input measurement resurfaces them.
5. **Suggestion lifecycle / weekend model (moat) rises** — answers are good enough that tracking outcomes is where durable value now sits.

**Reference artifacts:** roadmap overview `claude.ai/code/artifact/2c08a41a-1a2a-4be4-b2fd-bf12a9105ee8` · grounding review `claude.ai/code/artifact/823609cb-6ac7-44e4-a035-225b42cb6254` · genericness blind-rater `claude.ai/code/artifact/ca1d4dd0-6277-4d15-9827-f78072abe040`.

---

## The fundamental decomposition

A best-possible suggestion is four things. Each is a distinct demand on the knowledge
layer:

| Part of the answer | What it requires |
|---|---|
| **Diagnosis** — what the car is doing and *why* | Candidate causes with **priors** (context, recency of changes, community base rates) and **data-first disambiguation**. A reverse index (symptom → edges) *if* failure data shows diagnosis is weak. |
| **The one lever** — highest-leverage move for *this* context | Claims carrying **strength** (typical magnitude) and **predictability** (how reliably the effect appears at all) as separate attributes. |
| **Honest confidence** — exactly as sure as the evidence allows | **Predictability + provenance tier** per claim; confidence computed as a **ceiling** = min(evidence rung, **diagnosis-certainty** rung). |
| **A checkable prediction** — expected effect + what to feel + the falsifier | The tendency side of the claim, with a **detection-difficulty** attribute so the falsifier is feelable by this driver. |

**Core claim:** every dimension of suggestion quality is bounded by whether the
knowledge layer encodes *why* + *how-reliably* + *under-what-conditions* — not just
*what*. Prose ground truth is necessary but the wrong shape to verify against, and
(pending failure evidence) possibly also the wrong shape to diagnose with.

---

## Keystones — one confirmed, one candidate, one long-run

1. **Honesty keystone (confirmed) — predictability + provenance on every claim.**
   `predictability: reliable | usual | situational | experimental`, separate from
   strength, plus evidence tier (physics derivation · expert testimony · community
   data · this-driver outcome). This is what the verify pass and the false-confidence
   veto read. Prerequisite: **claims must have identities first** — see step 2a.

2. **Diagnosis keystone (candidate — earns its rank from failure data).**
   Symptom taxonomy + reverse index (symptom → candidate edges) + disambiguation.
   Promoted to early build **only if** step 1's failure-class tagging shows
   misdiagnosis is a real failure mode; otherwise it stays inside step 4,
   demand-driven. Design requirements if/when built:
   - **Priors, not flat lists.** The reverse index says which edges *could* cause
     "loose on exit"; abduction without base rates degenerates into a laundry list
     (failure mode #3) wearing a graph costume. Every symptom cluster carries
     founder-ranked likelihoods, modulated by context — and the strongest, cheapest
     prior is **recency: the most probable cause of a new symptom is what just
     changed.** Community aggregation sharpens priors later.
   - **Data-first disambiguation.** Each disambiguator is typed: **data-check**
     (setup snapshot, compare deltas, lap-time decay, conditions, notebook — consult
     first) vs **driver-observable** (ask only when data can't split it). Asking the
     driver something the data already answers is the amateur move a real engineer
     never makes. "The one sharp question" is the **residue after data checks**, not
     the first move.
   - **Per-cluster decision tree, not pairwise tables.** Pairwise disambiguators are
     O(n²) per cluster (6 candidates = 15 pairs). Author a most-informative-check
     ordering / small decision tree per cluster instead — same idea, cheaper artifact.
   - **Taxonomy validation:** inter-rater agreement — founder + a couple of expert
     drivers independently map a sample of real messy driver notes onto the taxonomy.
     Low agreement = mis-grained (too fine → unreliable mapping; too coarse → merges
     causes needing different edges). Fix before any model touches it.
   - **Versioned, stable label IDs from day one** — revisions must not orphan notebook
     history or mined clusters. Per-discipline vocabularies (offroad / onroad don't
     share symptoms cleanly), matching the per-discipline KB structure.

3. **Calibration keystone (the long-run moat) — outcome→predictability revision loop.**
   Predictability values start as founder judgment: a *prior*, not a constant.
   Aggregate outcomes propose revisions; the founder gates promotion. Write-path
   discipline unchanged (the notebook never writes the KB directly). **Statistically
   guarded** — real outcomes are confounded (two changes at once, grip evolution, tire
   wear, driver improvement, subjective ratings), and there's a systematic bias:
   novices can't feel subtle effects, so subtle-but-real claims would accumulate
   "no change" outcomes and get revised downward — the loop teaching the KB that
   subtle physics doesn't work. **Admission criteria before anything reaches the
   founder:**
   - only **single-change runs** with logged outcomes count as observations;
   - **stratify by class/surface** (predictability may be conditional — high for 1/8
     offroad, low for touring);
   - **weight or filter by driver skill tier**;
   - **minimum-N threshold** per claim before a revision proposal is generated.
   Without these, the founder gate gets spammed with noise and the moat becomes a bias
   amplifier.

---

## Architecture decisions (locked by this plan, pending founder approval)

### Two stores, one confidence ladder

| Store | Content | Write path | Speed |
|---|---|---|---|
| **Ground-truth KB** (prose + future graph) | Mechanism — what's true in general, how predictable | Founder-gated (`AGENTS.md`) | Slow, deliberate |
| **Weekend / driver notebook** | Outcomes — what happened for this driver/event | Auto-written, background | Fast, accumulating |

The evidence-tier ladder spans both ("settled physics" → "well-documented" →
"community data suggests" → "your own runs showed"). A suggestion starts as pure
mechanism on a cold weekend and *earns* higher, more specific confidence as
this-driver outcomes accrue against the same claim IDs. The notebook never rewrites
the KB (revisions go through keystone 3's gated loop).

### Claims are addressable units, not prose locations

The prose KB must be **atomized into enumerated claim units with stable IDs**, each
carrying predictability, provenance, and conditions. This is real migration work and
it is the actual substance of step 2 — the tags are the easy part. It also has an
urgent downstream consumer: **the suggestion lifecycle records which claim IDs each
suggestion relied on from day one**, even before any graph exists — retroactive
linking won't work, and without captured IDs the revision loop has nothing to
accumulate against.

### Prose and graph — roles, not rivalry

- **Graph / structured claims** = what the Engineer *verifies with* (and, if the
  failure data warrants it, reasons with).
- **Prose** = ground truth and the *teaching layer* — what it quotes when explaining why.
- Structured claims are **derived from already-approved prose** where possible
  (provenance tier: "derived from approved prose", founder spot-checks) — reuse the
  sunk approval work; don't demand a second full authoring pass.

### Confidence rung = ceiling, with diagnosis certainty in the min

Computed cap = **min( evidence rung, diagnosis-certainty rung )** where the evidence
rung = f(claim predictability, provenance tier, data agreement, spine certainty). If
the understanding layer preserved ambiguity — three candidate symptoms still live —
even a `reliable` claim cannot license "Decisive", because we're not sure it's the
right claim. Without this min, the ambiguity-preserving understanding layer and the
cap don't compose, and false confidence enters through the front door of the machinery
built to stop it.

The model may express **less** confidence than the cap, **never more** — asymmetry
aimed at failure mode #1 (false confidence) while tolerating #4 (over-hedging), per
the north star's preference order. `f` must be bench-calibrated on trap cases
**before** the rung goes live. Honest note: "data agreement" is an LLM judgment, not
arithmetic — a soft link, named as such.

### Claim classes for the verify pass

| Claim class | Rule |
|---|---|
| **Physics / mechanism** | Must trace to a claim ID (prose-atomized or graph edge) |
| **This-driver empirical** | Must trace to the notebook |
| **Procedural / craft** (tire prep, driving line, "no change — verify repeatability") | Allowed, appropriately hedged, never stated as mechanism |

**Anti-gaming rule:** the verify pass classifies claims **independently of the
author-model's labels** — "must trace" creates an incentive to costume physics as
craft to escape tracing; never trust the generator's own classification.

### Coverage honesty — the fallback contract

Demand-driven building means most symptoms will lack structured coverage for a long
time. When a symptom maps to nothing (or outside the taxonomy), the live contract is:

1. fall back to **prose-only reasoning**;
2. **cap the rung at "Leaning" or below**;
3. **say so** ("this is outside my structured knowledge — here's my mechanism-level read");
4. **log the miss** into the authoring queue.

Never-bluff applied to the graph itself — and the miss log doubles as free mining
telemetry for what to author next.

### The driver is in the model

- **Detection-difficulty** attribute on tendencies/falsifiers; the Engineer picks
  predictions this driver can actually check within one run.
- **Driver skill tier** — needed by two features now (falsifier selection, revision-loop
  weighting), so its source must be picked deliberately. Self-report skews (sandbagging
  pros, optimistic novices); **prefer inference from data already captured** — lap-time
  consistency and pace-vs-community — possibly seeded by self-report. Slots into the
  Personalization contract (visible + editable, per north star Phase 4).

### Interactions — a policy, not a model

Encode interaction claims **only** where the founder explicitly knows and approves
them; verify rule: a suggestion touching a parameter with known interactions must
**mention or hedge the interaction**. Modeling interactions fully ends in a vehicle
simulator — don't.

---

## Sequencing — each step measurable before the next

The current bench (9.0/10 prose-only) is near judge saturation — measure
calibration-trap performance and veto rate, pairwise-judged, not aggregate score.

| Step | What | Measured by | Status |
|:--:|---|---|---|
| **1** | **Eval upgrade** — calibration-trap cases, false-confidence veto measurement, rubric-decomposed judge, production→bench mining, **failure-class tagging of every bench + production failure: misdiagnosis vs miscalibration vs genericness vs laundry-list**. **Hold out a trap set never used in iteration, only in gating** (else prompts overfit trap surface features). | Judge-vs-founder correlation holds on rotating blind sample; veto rate on traps moves independently of aggregate score; failure distribution published | 🟡 Tooling built 2026-07-08: `failureTaxonomy.ts` (four-class map, misdiagnosis-blind by construction) + `failureClassifier.ts` (rubric-decomposed LLM, measures misdiagnosis + false-confidence veto) + `engineer:bench:failures` report. Free tag-mapped numbers published (gpt-4o: genericness-dominant 47%, miscal 7%, misdiagnosis unmeasured; gpt-5.5: 0 measurable). **Coverage-attribution added** (`kbCoverageManifest.ts` — the classifier is handed a ground-truth manifest of the 16 approved files and splits each knowledge failure into `kb_gap` (→ KB sweep) vs `in_kb` (→ diagnosis keystone), so an incomplete KB can't inflate the misdiagnosis count). **Decisive `--classify` run + held-out trap set + production mining pending.** |
| **2a** | **Claim atomization** — decompose prose KB into enumerated claim units with stable IDs; suggestion lifecycle starts recording relied-on claim IDs immediately | Every physics statement in a full-tier answer traceable to a claim ID; lifecycle rows carry claim IDs | 🟡 Schema built 2026-07-08: `src/lib/engineerPhase5/kbClaims/` — stable opaque IDs (`vdk-NNNN`, decoupled from headings), predictability + evidence-tier + claim-class + conditions per claim, retirement chain, pure validator, empty gated registry. **Atomizing prose into claims is founder-gated content — proposal pending.** |
| **2b** | **Predictability + provenance tags on the atomized claims** — founder-gated per `AGENTS.md` | Verify can check "stated confidence ≤ what the cited claim's predictability supports" | ⬜ Gated on 2a |
| **3** | **Computed-cap live** — min(evidence rung, diagnosis-certainty rung); `f` calibrated on step 1's trap cases first | False-confidence veto rate drops; negligible latency on humble answers | ⬜ Gated on 1 + 2b |
| **4** | **Structured diagnosis layer, IF the failure distribution demands it** — symptom taxonomy (inter-rater validated, versioned IDs, per-discipline) + reverse index with priors + data-first decision trees + detection difficulty + interactions policy + fallback contract, for the **top symptom clusters from production mining** | Pairwise vs prose-only **on misdiagnosis-tagged and trap cases specifically**; miss-log rate declining on covered clusters | ⬜ Gated on 1's failure data |
| **5** | **Outcome→predictability revision loop** — admission criteria above; founder gates every revision | Revised claims outperform their priors on subsequent admitted outcomes; proposal noise rate acceptable to founder | ⬜ Gated on 2a (claim IDs in lifecycle) + suggestion lifecycle (north star Phase 3) |

Related but sequenced elsewhere (north star rollout table): suggestion lifecycle,
weekend notebook, understanding layer. Step 4 subsumes the north star's Phase 10
"graph pilot" — the pilot ships *with* priors + data-first disambiguation or not at all.

---

## Explicit don'ts (carried across all review rounds)

- **No fine-tuning now** — freezes us off the frontier; model choice was the single
  biggest measured lever (gpt-4o 5.93 → gpt-5.5 9.0).
- **No live multi-agent committee** on the reasoning path — single-call reasoning
  schema + confidence-scaled adversarial verify (second call only when the answer
  claims decisiveness).
- **No cheap model on the understanding layer** — it maps the driver's words onto the
  symptom vocabulary; wrong mapping = precise reasoning over the wrong claims.
- **No five-stage sequential pipeline trackside** — latency the 10–15 min window
  can't afford.
- **No asking the driver what the data already answers** — data-check disambiguators
  run before any question is asked.
- **No full-graph or full-taxonomy authoring sweep** before failure tagging + production
  mining say what matters.
- **No shipping the computed cap** before `f` is validated on held-out trap cases.
- **No revision proposals from confounded outcomes** — admission criteria are
  mandatory, not aspirational.

---

## First concrete artifact (revised)

Not the taxonomy yet. **(a) Failure-class tagging of the existing bench + rated
production answers** (misdiagnosis / miscalibration / genericness / laundry-list) and
**(b) a claim-ID schema for the prose KB**. Roughly a week of work, and it decides
with numbers whether the diagnosis keystone or the calibration keystone deserves the
next month. Both proposed in chat, founder-gated where they touch KB content, per
`AGENTS.md`.

---

**Changelog:**
- 2026-07-08 rev 3 — **step 1 built + run; premise revised.** Added "Session findings & revised direction" up top: both pre-nominated keystones ruled out on gpt-5.5 (misdiagnosis/miscalibration 0/30); differential grounding refuted the genericness alarm as a single-context artifact; production flywheel empty (3 rated answers). Founder redefined the target to best-possible-relentless (not failure-free), with aggregation judgment (incl. data-density trust + "median is not a target") as the sharpest axis. Shipped first quality fix: `openaiEngineer.ts` rule (12) sample-size trust + rule-10 dead-reference fix. Sequencing revised (measure real+cold → improvement engine → aggregation-judgment eval → shelve steps 2a–5 → moat rises).
- 2026-07-08 rev 2 — third review round: keystone ranking now earned by failure-class
  data, not asserted; claim atomization inserted as step 2a; disambiguators data-first
  with priors and per-cluster decision trees; diagnosis certainty added to the
  confidence cap (min); fallback contract for uncovered territory; revision-loop
  admission criteria; held-out trap set; verify classifies claims independently;
  driver skill tier inferred from data; taxonomy inter-rater validation + versioned IDs.
- 2026-07-08 initial — synthesized from two agent review rounds (ranked AI bets +
  fundamental critique) on top of `ENGINEER_NORTH_STAR.md`.
