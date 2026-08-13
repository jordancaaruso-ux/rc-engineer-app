# Vehicle dynamics KB — physics-first roadmap

This document is a **working scaffold** for expanding [`content/vehicle-dynamics/`](../content/vehicle-dynamics/). It is **not** shown to the Engineer as retrieved KB.

## Goal

Keep **stamped KB** prose **mechanics- and physics-forward**: what changes do to geometry, loads, kinematics, and documented *tendencies*. Reserve **driver level**, **feel vs lap time**, **when to bundle changes**, and **community vs outlier** framing for the **system prompt** (see [`src/lib/engineer/prompt.ts`](../src/lib/engineer/prompt.ts)).

## Entry structure — Physics / Handling split (adopted 2026-07-08)

Every knob in a KB entry splits into two labelled blocks so the Engineer can quote each at the right confidence:

- **Physics.** What the change does **mechanically** — geometry, loads, kinematics. **Stated flat, with confidence** (this is Layer 1: irrefutable, condition-independent, portable across disciplines forever). No hedging on mechanism.
- **Handling.** What it *can* do to the car — the **situational** effects on grip/balance/feel (Layer 2). **Openly hedged**: name the dependencies (grip, tyre, layout, what's limiting the car) and frame as a test to confirm. Never assert a handling outcome the physics doesn't force.

**Refinement (2026-07-23, founder-adopted).** The Handling block is written as **explicitly context-keyed effects**, not one hedged paragraph: each effect names the **condition it depends on** (grip / tyre / layout / what's limiting the car) inline, and the block ends with a **Predictability:** line — one tag (`reliable` | `usual` | `situational` | `experimental`) plus a short reason naming what makes the effect dependable or variable. It rates how reliably the *effect* appears (the honesty keystone from `ENGINEER_SUGGESTION_QUALITY_PLAN.md`), kept separate from effect strength, and carries **no coaching** — "always / never change X", "tune together with Y", "test first" are tuning discipline and live in the system prompt, not the KB. Ladder: reliable = shows up almost every time · usual = normal, exceptions exist · situational = flips with grip/tyre/layout · experimental = theory-first, founder-unconfirmed. Retrofit label: **"Effects (context-dependent — confirm on track)."** In a pure retrofit, physics content must not change — restructure + context-tag only; any physics/claim change the founder dictates during the pass is a separate, explicitly-approved edit.

Maps onto the three-layer architecture in `ENGINEER_NORTH_STAR.md` and the epistemic stance *"confident on mechanism, humble on outcome."* Reference implementation: `drafts/shock-geometry.md` (2026-07-08). This is the house style for **all new entries**; the 16 approved files predate it and are queued for retrofit (see below).

## Governance

Per [`AGENTS.md`](../AGENTS.md) (two-tier since 2026-07-07): **top-level** `content/vehicle-dynamics/` files remain founder-approved ground truth — do not add or edit without explicit approval naming the file. Agents MAY write AI-drafted baseline files under `content/vehicle-dynamics/drafts/` freely (provenance banner required; loaders label them; the Engineer cites them hedged). Promotion = Jordan edits/interviews through a draft, then it moves up with the banner removed.

## Batch 1 outcome (2026-07-07 — drafted, claim-checked, corrected, and PROMOTED same day)

Review surface: KB workbench artifact https://claude.ai/code/artifact/a9fb7cfd-8a44-44e5-995c-20d514119595 (claim checks → export JSON → agent applies). Founder verdict: rewrites confirmed (`r2-ok` all six); five promoted, one kept as draft.

| File | Status | Claim-check outcome |
|---|---|---|
| `anti-dive-anti-squat.md` | ✅ **Promoted** | Signs + bump trade confirmed; founder point added (anti speeds up load transfer); steady-state framing softened |
| `ride-height-and-rake.md` | ✅ **Promoted** | Rake + 0.2 mm step confirmed; "lower=grip" hedged; corrected: lower always helps traction rolling |
| `diff-and-driveline.md` | ✅ **Promoted** | Two inversions corrected: thicker oil normally = on-throttle oversteer; low grip → thinner / more grip → thicker |
| `steering-geometry-ackermann.md` | ✅ **Promoted** | Rewritten: more ackermann = less steering/easier; founder reduces ackermann for tight layouts; param = link position on rack |
| `weight-distribution-and-ballast.md` | ✅ **Promoted** (polar/lateral sections carry inline "not yet founder-verified" labels) | Inversion corrected: more front weight = less steering (pendulum effect) |
| `drafts/track-width-wheel-spacers.md` | 🟡 Draft (founder untested) | Experimental theory — Engineer advises it only as a test to run |

Approved corpus after batch 1: **16 files, ~54K chars** (was 11 / ~38.5K).

## Batch 2 (2026-07-07 — drafted from founder platform-semantics interview; awaiting claim-check/promote)

Founder interview established (tap-to-answer, 2 rounds): **spring_gap** = Awesomatix effective spring rate, bigger = stiffer (NOT preload) · **damper_percent** ≈ piston size, higher = more damping, pack/progression in play · **upstop** = compression-travel limit, bigger = less travel, "effects are complex" · **rear_hrb_setting** = shims raising the rear of the bodyshell → more rear grip/stability at speed (aero) · **servo_horn_height** = effectively servo speed, shorter horn = smoother (NOT bump steer).

| Draft | Covers | Open claims |
|---|---|---|
| `awesomatix-spring-gap-damper.md` | Spring gap (rate) + damper percent (damping/pack) | ✅ **Promoted 2026-07-30.** Pack ruled: higher % = fewer holes = more pack (Awesomatix-specific) |
| `drafts/upstop-compression-travel.md` | Compression-travel limit; goes-solid mechanism | When (if ever) upstop is the first lever |
| `drafts/bodyshell-aero.md` | Rear body height (founder-confirmed aero direction); body position theory | Cost of raising rear shell; fore/aft position tendency |
| `servo-horn-steering-response.md` | Servo speed / steering response; explicitly not bump steer | ✅ **Promoted 2026-07-30** (recipe bullets cut in the unarguability audit) |

## Batch 3 (2026-07-08 — cross-platform breadth begins; interview-driven, prose-only)

Founder direction (interview 2026-07-08): breadth is the bottleneck, not depth; fill knobs other touring cars expose that Awesomatix does not; keep the structured mechanism-graph **parked** (full-KB-in-context prose is working). Coverage audit against the A800 sheet confirmed the universal chassis physics is ~complete; the remaining gaps are cross-platform hardware + a few Awesomatix internals.

| Draft | Covers | Status |
|---|---|---|
| `shock-geometry.md` | Motion ratio (position/angle), bump stops/packing, shock length/travel window | ✅ **Promoted 2026-07-30** after the motion-ratio section was decomposed into its two opposing strands (lever vs angle — founder caught the collapsed "inboard = softer" net direction). |

Also promoted 2026-07-30: `concepts/corner-regime.md` (steady-state vs transient regime framing, drafted 2026-07-29 from the rear-spring/rotation feedback error; steady-state rear strand founder-reviewed) and the bite-hold physics channels (merged into `concepts/bite-hold.md`, draft deleted).

**Cross-platform clusters still un-drafted** (interview-driven when founder has bandwidth): drivetrain variants (spool / gear diff / ball diff / one-way, belt tension) · steering system (bellcrank/rack position, servo-saver stiffness) · wheelbase + front kick-up (thin — fold into a geometry pass). Note: "roll centre / anti-geometry via eccentrics & inserts" is **not new physics** — the mechanism is already covered; other cars' hardware for it is Layer-3 vocabulary only.

**Parked — Awesomatix internals (founder to explain before drafting):** `diff_height_front/rear`, `pss_percent_setup_front/rear`, `srs_arrangement_front/rear`, `c45_installed_front/rear`, the distinct `damping_front/rear` field, `diff_shims`. Fields on the A800 sheet with zero KB coverage; semantics need a founder interview first.

## Queued projects

- **Retrofit approved files to the Physics/Handling split** — **in progress, started 2026-07-23** (was founder-approved 2026-07-08). All 16 top-level `content/vehicle-dynamics/*.md` files predate the split and blend the two in prose. This is an **approved-tier edit** — gated by `AGENTS.md`: per file, agent proposes the restructured diff, founder types casual change notes, agent folds them in, founder approves, then written. Physics content unchanged in a pure restructure; founder-dictated claim changes are separate approved edits. Re-verify any `parameterEffects/catalog.ts` anchors after (catalog is currently empty, so none today). **Retrofit order + status tracked in the Authoring walkthrough table below.**

## Suggested physics-first topics (fill over time)

Use each as a checklist; merge or split files to stay under ~90 lines per file where possible.

| Topic | Intent (physics layer) | Existing KB to align / extend |
|--------|-------------------------|--------------------------------|
| Tire contact patch & slip | Camber, load transfer, and peak mu window (no “more grip = faster” without conditions) | `camber-caster-toe.md`, `response-vs-sustained-grip.md` |
| Load transfer basics | CoG, wheelbase, track width, roll stiffness split | Tie to spring/ARB/RC docs |
| Spring as wheel rate / ride frequency | Stiffness vs mechanical grip and platform control | `spring-rate.md` |
| Damper as **velocity** control | Low/high speed split conceptually (oil vs piston if you document it) | `damper-oil.md` |
| Anti-dive / anti-squat geometry | Instantaneous longitudinal load transfer vs bumps | `support-lower-inner.md`, bump-steer doc |
| Roll centre & migration | Jacking, lateral load transfer distribution | `roll-centre.md` |
| Bump steer & toe gain | Kinematic curves vs static toe | `bump-steer-toe-gain.md` |
| Droop vs downstop | Definitions, combined vs separate sheets | `droop-downstop-arb.md` |

## Migration pattern

1. Draft prose in chat or here as bullets.
2. Strip **subjective coaching** (“always do X for slow drivers”) → move to prompt if still wanted.
3. Keep **hedges** where physics is genuinely situation-dependent (surface, tire, layout).
4. After approval, edit the named KB file; if `parameterEffects/catalog.ts` cites that file, re-verify catalog rows against the new anchors.

## Authoring walkthrough (Jordan notes → agent draft → explicit approve)

**Order:** alphabetical by filename under `content/vehicle-dynamics/`, **excluding** [`README.md`](../content/vehicle-dynamics/README.md) (meta only — revisit last if needed).

| # | File | Status |
|---|------|--------|
| 1 | `balance-and-grip.md` | **drafted** — review prose in repo; next file when satisfied |
| 2 | `bump-steer-toe-gain.md` | **drafted** — mechanics + platform conventions |
| 3 | `camber-caster-toe.md` | **drafted** from Jordan Q&A; review toe + prompt rule (6) alignment |
| 4 | `damper-oil.md` | pending |
| 5 | `droop-downstop-arb.md` | pending |
| 6 | `flex-chassis.md` | pending |
| 7 | `response-vs-sustained-grip.md` | renamed from initial-vs-overall; vocabulary aligned |
| 8 | `roll-centre.md` | pending |
| 9 | `spring-rate.md` | pending |
| 10 | `support-lower-inner.md` | pending |
| — | `README.md` | optional last |

Update the **Status** column as each file is drafted and approved in chat.

## Related code

- Engineer system prompt: [`prompt.ts`](../src/lib/engineer/prompt.ts) (`ENGINEER_CHAT_SYSTEM_PROMPT`)
- KB loader (full corpus in context, no retrieval): [`kb.ts`](../src/lib/engineer/kb.ts)
