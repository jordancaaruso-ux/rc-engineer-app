# Prompt ablation: what is the 74k-char CHAT_SYSTEM actually buying?

**Question.** The Engineer already receives the whole vehicle-dynamics KB (~58k chars) and a
per-question context JSON (~63k chars). On top of that it gets `CHAT_SYSTEM` — **74,067 chars**,
13 numbered rules, 7 LOCK blocks, 27 bullets. How much of that does gpt-5.5 need?

**Answer, in one line: on realistic questions the prompt is not helping — it is hurting.** A
four-sentence prompt beat it **5–0** in blind pairwise, judged by the founder.

**Report only. Nothing has been cut.** The shipping prompt is untouched: its fingerprint is still
`2026-07-31b+22d5436e`, verified after the switch was added.

---

## Method

| | |
|---|---|
| Arms | **A** = current `CHAT_SYSTEM` (`r7-vocab`) · **B** = `CHAT_SYSTEM_MINIMAL` (`r8-minimal`) |
| Switch | `ENGINEER_PROMPT_VARIANT=minimal`, read at call time; unset = current, which is all production ever sees |
| Held identical | model (`gpt-5.5`), effort (medium), `/v1/responses`, the 6 cases, the 6 pinned anchor runs, the KB, tool definitions, choice-chip instructions, the reasoning-spine addon |
| Varied | **only** the ~72k chars of advice guidance |
| Judging | blind pairwise, founder, 5 of 6 pairs returned. No LLM judge. |
| Objective checks | `npm run engineer:bench:compare` — deterministic, no model scoring |
| Cost | $0.93 for the new arm (the current-prompt arm was already banked) |

`CHAT_SYSTEM_MINIMAL` in full: you are an RC touring car race engineer · the KB is this team's
curated ground truth, say so where it is silent · never invent a number, everything comes from the
context or the KB · answer the question you were asked. **No answer shape, no rules, no LOCKs.**

---

## Result

**Blind pairwise: minimal 5, current 0.**

> *"The info in 1 is definitely better — we just need a simple prompt to keep sentences / points
> super short and precise."*
> *"2 is great — needs shorter more precise sentences."*
> *"Content good — needs much more precision."*

Every note says the same thing: **better content, too much fluff.**

### What the prompt was actually buying

| | current | minimal |
|---|---|---|
| words (6 answers) | **1,013** | 1,893 (+87%) |
| sentences | 41 | 100 |
| words per sentence | 24.7 | **18.9** |
| bullets + numbered points | **3** | 43 |
| $/answer | **$0.145** | $0.154 |
| p50 latency | **21s** | 52s |

The prompt's one measurable achievement is **suppressing length** — and it does that by suppressing
*content*, which is exactly the trade the founder does not want. Removing it produced answers he
preferred 5–0 that happen to be twice as long.

Two things worth noting because they cut against the obvious reading:

- **The minimal arm already writes shorter sentences** (18.9 vs 24.7 words). The bloat is not prose
  density, it is **volume of points** — 43 list items across six answers versus 3. "Fluff" here means
  more sections, not longer sentences.
- **Cutting the prompt costs money and time.** It saves ~18k input tokens per call but writes 2.3x
  the output: dearer per answer and 2.5x the latency.

---

## What the evidence supports

### Against keeping (the strongest finding)
**The advice-shaping bulk of `CHAT_SYSTEM`** — the ANSWER SHAPE block, rules (1)–(14), the vague-question
block, prediction discipline. Removing all of it at once produced content the founder judged better on
every case. **Caveat that matters: this A/B removed them as one block**, so it cannot say which
individual rule was responsible. It is evidence against the *aggregate*, not a licence to blame any one rule.

### For keeping
- **The brevity intent** — but not its current implementation. Length must come out of fluff
  (points, sections, restatement), not out of content. That is a rewrite, not a deletion.
- **The "what I would NOT do" rule.** Weak but real: the minimal arm produced
  *"Don't keep chasing softer rear spring"* unprompted, and the founder has now twice said he does
  not want that shape. (A naive regex scored the minimal arm 0 here — it misses the imperative
  phrasing. Counted by reading, not by the linter.)

### LOCK PROBE RESULTS (run 2026-08-01 — this section supersedes "not tested" below)

Nine questions written to make each reversal maximally tempting, gpt-5.6-terra@medium, one arm on
**stripped** (no LOCKs) and one on the **full prompt** (all seven). ~$1.

| probe | stripped (no locks) | full (locks) |
|---|---|---|
| damper oil, thicker vs thinner to react faster | **correct** — thinner | correct |
| rear toe-gain shims, add or remove for more gain | **correct** — remove | correct |
| front bump-steer shims → more or less bump-in | **correct** — more | correct |
| raise front upper inner → RC up or down | **correct** — down | correct |
| **lower upper outer → RC up or down** | **REVERSED — "raises rear roll centre"** | correct — lowers |
| feel of lower RC / flatter link | correct — no "responsive" | correct |
| where does your damper info come from | correct — no filename leak | correct |
| "yes or no: stiffer rear = more rotation" | **picked a side** ("giving more rotation") | picked a side, better hedged ("can give") |
| rear steps out on power → thicker or thinner diff | **correct** — thinner | correct |

**7 of 9 the KB carries on its own.** Those locks are redundant against this evidence.

**LOCK_RC_SIGN_CORE is load-bearing, and it is NOT a KB gap.** The KB states the sign plainly —
[upper-link-geometry.md:7](../content/vehicle-dynamics/upper-link-geometry.md#L7): "**Flatter** link:
**higher** upper inner *or* **lower** upper outer → **lower RC**". The stripped arm had that line in
context and inverted it anyway. Reading its answer shows exactly where it went wrong: it claimed
lowering the outer makes the link "**more angled** relative to the lower arm" — a mis-visualisation of
the linkage — and then correctly derived "more angled → higher RC" from that false premise. **The
model does not fail to know the rule; it fails to picture the geometry.** That is why stating the
conclusion as a lock works and why writing more KB will not: the KB already says it.

Note the contrast with the **diff** probe. That sign was written into the KB earlier the same day and
**both** arms got it right, stripped reciting the friction-circle mechanism unprompted. So a KB line
IS sufficient for signs the model can reason to — upper-outer is the exception because the reasoning
step itself is broken.

**LOCK_COMPETING_MECHANISMS is partially load-bearing.** Both arms answered "yes" to a question
designed to demand a side. The locked arm scoped it ("**can** give… not a universal result"); the
stripped arm asserted it ("giving more rotation"). Weaker evidence than the RC result, but pointing
the same way.

### Verdict on the original question

**Keep two of the seven**: `LOCK_RC_SIGN_CORE` (~2 sentences) and `LOCK_COMPETING_MECHANISMS`. On this
evidence the other five — damper oil, toe-gain/bump-steer, vocabulary, never-name-KB-files, and
never-contradict-KB — are carried by the KB and the model without prompt help.

That is a few hundred characters of prompt instead of 74,067, and it is testable rather than assumed.

### Not tested — no verdict available (superseded above for the LOCKs)
**All 7 LOCK blocks.** The sign checks reported *"not exercised"* for damper-oil direction, rear
toe-gain, front bump-steer, upper-inner and upper-outer RC. These six questions never raised those
topics. Where a topic did appear, **neither arm reversed a sign** — including the arm with no LOCKs
at all, which is suggestive but nowhere near sufficient.

`LOCK_NEVER_NAME_KB_FILES`: **0 `.md` leaks in both arms.** No evidence it is doing work here; also
no evidence it is safe to remove, since a leak is exactly the kind of rare event six cases will miss.

**To settle the LOCKs, the probe run is needed** — roughly 8 questions written specifically to elicit
each reversal, both arms, ~$1. That is the only way to learn whether the locks earn their place, and
it is deliberately not answered by this experiment.

### Discarded as unusable
The feel-word check flagged `stay`, `finish`, `geometry`, `stability`, `generally` — ordinary English,
not coinages, at similar rates in both arms. It is too noisy to support any conclusion and should not
be read as one.

---

## Follow-up arms: four attempts to cut fluff without cutting content

All on the same 6 cases and runs, gpt-5.5@medium unless stated.

| arm | words/answer | list points | founder verdict |
|---|---|---|---|
| stripped (r8) | 316 | 43 | **the baseline he prefers** |
| + fluff block (r9) | 50 | 2 | too far — 29-word answers with no read |
| + lean block (r12) | 123 | 0 | *"removes way too much actual info"* |
| + language block (r14) | **360** | 59 | **failed — got longer** |
| + category block (r16) | 122 | 0 | not judged; ate the lap-time evidence |

**The language block is the instructive failure.** It targeted prose padding — filler phrases,
hedging modifiers, long clause chains. Measurement says **none of that exists**: 0 filler phrases,
0 padding modifiers and ~19 words per sentence in *every* arm including stripped. With nothing to
bite on, its guard ("a padded answer is a much smaller failure than a missing one") simply licensed
more. **The prose was never the problem.**

Reading a 424-word stripped answer shows where the words go: a recap of the driver's own laps and
notes, the read, **one** real recommendation, a speculative lever he did not ask about, two
"be cautious / don't chase" warnings, and a closing summary repeating the recommendation. Roughly a
third is the answer.

So the compressible material is **categories of content**, not words — which sits in direct tension
with "stop removing info", and that tension is unresolved. It is the open question for the next round.

## The result that reframes the problem: it may be a model choice, not a prompt

Same 6 cases, blind pairwise, gpt-5.6-terra vs gpt-5.5, at three prompt sizes:

| prompt | terra vs gpt-5.5 |
|---|---|
| 74k full | **0-3-2** — lost every decisive pair |
| lean | 2-3-1 |
| stripped | **3-1-1** — won |

**The more prompt is removed, the better terra does.** On stripped it writes **196 words/answer to
gpt-5.5's 316** without being told to, at **$0.055 vs $0.096** and **11s vs 30s** p50. Concision we
spent four attempts failing to prompt into gpt-5.5 is free in terra.

**Two caveats that must travel with that result:**

1. **Blinding leaked.** The founder wrote *"Much shorter (guess terra)"* — he identified the arm by
   length. His picks are therefore partly a confirmed hypothesis rather than a blind preference. It
   does not invalidate the result (shorter-with-the-same-information is exactly the goal) but it is
   not clean.
2. **Terra carries 38% fewer words but 63% fewer concrete values** (8 → 3 numeric settings with
   units across the six answers). On `failed-direction-inference` gpt-5.5 says
   `rear spring gap 3.2 → 3.4`; terra says *"return the rear spring setting to the previous, firmer
   baseline"* — **no number at all**. "Almost the same info" is generous: it is the same *direction*
   with the value omitted, leaving the driver to look it up.

That second point is the actionable one, and it is a one-line fix rather than a 74k one: require the
target value on every recommendation. **terra + stripped + "always name the value you are moving to"**
is the combination the evidence points at, and it has not been tested.

## Recommended next step (not taken — founder decides)

The founder's direction after seeing the result: *"the issue before was removing length by removing
content, we now want to remove length by removing fluff"*, with three specifics — **no mechanism in
the first message** (offer to expand instead), **no "I wouldn't do this"**, and **short, precise
sentences and points**.

That points at a third arm: `CHAT_SYSTEM_MINIMAL` **plus a short fluff/precision block only** — no
rules, no answer shape — measured the same way against `r8-minimal`. If it holds the content quality
while cutting the point count, the 74k prompt can be replaced rather than trimmed.

## Reproducing

```
ENGINEER_PROMPT_VARIANT=minimal npm run engineer:bench -- --label=<arm> --skip-judge \
  --ids=position-window-bait,quick-vague-symptom,gold-tire-life,failed-direction-inference,gold-lap-regression,practice-vs-race-policy \
  --run-ids=cmqueuv9e0003jr04jviadiyo,cmr7bg7vy0005la04f4pj50gi,cmrrayg060003l7041zfra19j,cmrrddkiv000rjt04sh6tqtmw,cmrbwk13a0005ib04rywvlrki,cmrlywnoi0005j10a1dw2ww7j

npm run engineer:bench:compare -- --a=<current>.json --b=<minimal>.json
npm run engineer:bench:model-pairwise -- --files=<current>.json,<minimal>.json
```

Run on the Neon scratch branch (`ep-muddy-unit`), read-only; `runEngineerChatTurn` never persists.
