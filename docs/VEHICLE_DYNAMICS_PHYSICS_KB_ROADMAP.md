# Vehicle dynamics KB — physics-first roadmap

This document is a **working scaffold** for expanding [`content/vehicle-dynamics/`](../content/vehicle-dynamics/). It is **not** shown to the Engineer as retrieved KB.

## Goal

Keep **stamped KB** prose **mechanics- and physics-forward**: what changes do to geometry, loads, kinematics, and documented *tendencies*. Reserve **driver level**, **feel vs lap time**, **when to bundle changes**, and **community vs outlier** framing for the **system prompt** and rich context (see [`src/lib/engineerPhase5/openaiEngineer.ts`](../src/lib/engineerPhase5/openaiEngineer.ts) — `REASONING STANCE`).

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

Approved corpus after batch 1: **16 files, ~54K chars** (was 11 / ~38.5K). Batch-2 queue: `spring_gap_*`, `damper_percent_*`, `upstop_*`, `rear_hrb_setting`, `servo_horn_height` (need founder interview on platform semantics first), plus gap-driven topics as they surface.

Known platform-specific keys deliberately NOT drafted (semantics need founder interview first): `spring_gap_*` (preload), `damper_percent_*`, `upstop_*`, `rear_hrb_setting`, `servo_horn_height`.

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

- Engineer system prompt: [`openaiEngineer.ts`](../src/lib/engineerPhase5/openaiEngineer.ts) (`CHAT_SYSTEM`)
- Retrieval: [`vehicleDynamicsKb.ts`](../src/lib/engineerPhase5/vehicleDynamicsKb.ts)
- Structured effects (KB-locked): [`parameterEffects/catalog.ts`](../src/lib/engineerPhase5/parameterEffects/catalog.ts)
