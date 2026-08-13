# Handling Capture North Star

**Status:** Draft for founder review (2026-07-08). **Owner:** Jordan.

How a driver tells the app what the car did — the **handling details** captured at Run
complete (car rating, feel vs last run, corner balance, traits) and turned into signal
the Engineer reasons over. This doc governs the **capture vocabulary and its meaning**;
`ENGINEER_NORTH_STAR.md` governs how the Engineer *behaves* with that signal, and
`AGENTS.md` gates KB content. Where this and the Engineer north star disagree, the
Engineer north star governs until Jordan reconciles them.

This sits at the intersection of the two top pillars: **Pillar 1 (effortless logging)**
— every input is a tap cost paid on every run — and **Pillar 2 (Engineer)** — the
inputs are the Engineer's primary evidence about *this* run. A handling input only earns
its place if the signal it adds is worth the tap, and if it changes what the Engineer
would advise.

Derived from founder interview 2026-07-08 (this session).

---

## The governing principle

> **Corner balance (entry/mid/exit understeer↔oversteer) already carries the core
> push / rotate / loose story. Everything else must earn its tap by capturing something
> balance doesn't — and pointing at a different set of adjustments.**

Two consequences, both decided this session:

1. **Traits are problems you flag, not axes you fill.** They move from always-on sliders
   to **tap-if-notable chips**. Zero effort when the car is fine; a severity (and
   optional speed tag) only when there's something to say.
2. **The four traits that survived** each fail the "balance already covers it" test —
   i.e. each is orthogonal to push/loose and implicates different knobs.

---

## The capture model (decided)

| Input | Status | Required? | Capture | Scale / values |
|---|---|---|---|---|
| **Car rating** | keep | **required** (completed runs) | 1–10 buttons | 1–10; Engineer reads as **bands**, not literal points |
| **Feel vs last run** | keep | **required** when a prior run on the car exists | 5-button quick pick | Much worse / Worse / Similar / Better / Much better (−3/−2/0/+2/+3) |
| **Corner balance** | keep | optional | per-phase **two-pole instrument** (2026-08-03) | entry / mid / exit, each −3 (understeer) … +3 (oversteer) |
| **Steering feel** | keep (reframed) | optional | **flag-if-notable chip** | dull ↔ pointy (bipolar) |
| **On-power** | **NEW** | optional | **flag-if-notable chip** | hooks up ↔ snaps |
| **Braking** | **NEW** | optional | **flag-if-notable chip** | loose ↔ stable |
| **Traction rolling** | keep | optional | **flag-if-notable chip** | never ↔ often |
| **Drivability** | keep (reframed from `driveEase`) | optional | **flag-if-notable chip** | on-edge ↔ easy |
| **General character** (`feelGeneral`, smooth↔reactive) | **RETIRED** from capture | — | — | parser kept for old runs; not offered on new runs |
| **Speed tag** | **RETIRED** from capture 2026-08-03 | — | — | parser + Engineer read keep it for runs that already carry one; never offered on new runs |
| **Primary focus** | keep (lighter) | optional / implicit | see below | which flagged issue is the main one |

### The five traits — why each survives

Each chip captures a deviation balance can't, and points at knobs fixing understeer /
oversteer wouldn't touch.

| Chip | Poles | What it diagnoses (distinct from balance) | Typical knobs |
|---|---|---|---|
| **Steering feel** | dull ↔ pointy | Front-end directness/response. You can be balanced yet vague or hyper-darty. | caster, front toe, Ackermann, front tire/grip |
| **On-power** | hooks up ↔ **snaps** | Rear grip the instant you get on throttle — a *snap*, felt as distinct from steady exit oversteer. | diff, rear toe/camber, rear ride height, droop |
| **Braking** | **loose** ↔ stable | Rear stability when you lift/brake into a corner. Weight-transfer axis; overlaps entry balance but drivers report it separately. | diff, rear toe/camber, front droop, ESC drag brake, weight |
| **Traction rolling** | never ↔ **often** | Car trips over its outside edge in high grip — a limit/safety signal, not a balance one. | camber, droop, ARB, ride height, tire choice |
| **Drivability** | **on-edge** ↔ easy | How much a mistake is punished — margin / consistency. Gates whether to chase pace or calm the car. | broad; read as an outcome that caps confidence |

**Chips capture problems, not praise.** On-power, braking, traction-rolling and
drivability are effectively single-signed in practice — you flag the *bad* pole (snaps /
loose / rolls / on-edge); the good state is simply the absence of a flag. **Steering feel
is the one genuinely bipolar chip** (too dull *and* too darty are both real problems).
Positive / known-good signal is carried by the 1–10 rating and feel-vs-last, not by the
chips — this keeps chips zero-effort when the car is good.

**Considered and declined this session:** forward drive (bogs↔drives off), body roll, and
the general-character axis. Re-open only if flagged-inference logging (Engineer north
star) shows drivers repeatedly reaching for them.

### Severity

Each flagged chip carries **slight / moderate / severe**, mapping 1:1 onto the existing
internal magnitude (`|1|` / `|2|` / `|3|` on the −3…+3 scale). This preserves the
magnitude the Engineer read already consumes, so retiring the sliders costs no read
logic — only the capture surface changes.

### Speed tag

The low-speed vs high-speed axis is **orthogonal to corner phase** — a hairpin and a
sweeper need different fixes at the same phase. Rather than a phase×speed matrix (tap-
budget blowout), speed attaches as **one optional tag on any issue the driver already
flagged**: `Slow` / `Fast` / `Both`. High diagnostic leverage for one optional tap —
e.g. slow-corner understeer points at geometry/steering; fast-corner understeer points
at springs / grip / aero.

### Primary focus

With flag-if-notable chips, the flagged set *is* the shortlist of what's wrong. Keep a
light "which is the main one?" only when **2+ issues are flagged**; with 0–1 flagged it
is implicit and not asked. (Today's `primaryFocus` select stays as the mechanism, fed
from flagged chips + balance rather than every filled axis.)

---

## Rating scale — keep 1–10, read as bands

Decided: **keep 1–10** (one tap, best trend resolution). Analog scan of overall-goodness
scales in similar contexts backed this:

- Clinical pain (0–10 NRS) and Borg exertion (CR10) only work **anchored**; unanchored,
  people use them inconsistently.
- **NPS** is a 0–10 scale everyone collapses to **3 bands** in practice — evidence that
  fine points aren't used as fine points.
- 1–5 stars are more consistent but cluster at the top and lose trend resolution.
- Pro drivers rarely give an overall 1–10 — they give **balance deltas**, which the
  phase buttons already capture.

Two cheap upgrades, no capture-model change:

1. **Engineer reads bands, not points** — 1–3 bad · 4–6 workable · 7–8 good · 9–10
   dialled. A "7 vs 8" argument never drives advice.
2. **Light anchor labels** so a rating means the same thing across days and drivers.

**Regrouped 2026-08-03** (founder; was 4–5 workable · 6–7 good · 8–10 dialled). "Dialled"
now means a car you would race as-is, which two-thirds of the old top band did not; the 6
moved down to workable rather than flattering itself as good. The bands live in
`CAR_RATING_BANDS` (`src/lib/runHandlingAssessment.ts`) and are drawn on the picker itself,
so the driver rates in the same words the advice is built from — and the picker no longer
prints the reference-setup threshold, which only taught drivers to rate for the feature.

---

## Data model (v5 → v6)

`src/lib/runHandlingAssessment.ts` — bump `RunHandlingAssessmentParsed` to `version: 6`:

- **Add** `onPower` and `braking` traits.
- **Reframe** `feelSteering` → steering feel (dull↔pointy), `driveEase` → drivability
  (on-edge↔easy). Same signed −3…+3 storage; labels/poles updated.
- **Retire** `feelGeneral` from new capture; keep it in the parser so old JSON still
  reads (never offered in the UI again).
- **Add** speed tags — a small map keyed by flagged issue (`balance:entry`, `trait:onPower`,
  …) → `"slow" | "fast" | "both"`.
- Traits stay **stored as signed −3…+3** (preserving today's read semantics); the UI
  captures them via flag + slight/moderate/severe instead of a slider.

**Migration (read-time, like every prior version bump):** v5 rows map forward —
`feelSteering` / `driveEase` / `tractionRoll` carry over, `feelGeneral` is dropped,
`onPower` / `braking` / `speedTags` are absent (null). No signal the Engineer relied on
is lost.
Follow the existing `parseV5Raw` / `migrate*` pattern; add `parseV6Raw` and route
`version === 6`.

---

## Engineer consumption

> **2026-08-13:** the code this section referenced (`engineerPhase5/engineeringRead.ts`,
> `openaiEngineer.ts`, `scripts/engineer-bench/`) was deleted in the Engineer rebuild —
> see `docs/ENGINEER_NORTH_STAR.md`. Handling data will reach the rebuilt Engineer as a
> driver-data payload block (Phase 4 of the rebuild), and handling-read changes are
> measured by the new harness (`scripts/engineer-eval/`) with synthetic seed questions.
> What survives of this section as intent:

- `runHandlingAssessment.ts` formatters (`formatHandlingTraitAxisForEngineer`,
  `formatHandlingAssessmentForEngineer`) — update trait vocabulary; emit speed context
  ("understeer, mid — **slow corners**").
- When the driver-data block ships: rating is **bands** not points; a flagged trait is a
  *problem the driver chose to report* (weight it, but as fallible feel); speed tag
  narrows the knob set. No new false confidence — chips are driver feel, still fallible
  evidence.
- The harness's seed set should carry handling-payload cases with **exact chip values**
  so a read/prompt change produces a measurable score delta.

---

## Build sequence

Each step measurable before the next (per the done-checklist in `AGENTS.md`).

| # | Step | Status | Proves it |
|:--:|---|:--:|---|
| **2** | **Data model v6** — on-power + braking traits, retire general-feel from capture, speed tags, `parseV5OrV6Raw` + migration | ✅ 2026-07-08 | `runHandlingAssessmentV6.test.ts` (7 cases) + quick-pick/cross-run suites green; old v5 rows still read |
| **3** | **Capture UI** — flag-if-notable chips + severity + speed tag in `HandlingAssessmentFields` | ✅ 2026-07-08 (typecheck only) | tsc clean; **not yet driven in a browser** |
| **4** | **Engineer read + prompt** — read consumes new traits; prompt teaches band-read rating + speed→lever + chips-are-fallible | ✅ 2026-07-08 | `engineeringRead`/`quickFix` suites green; bench not re-run (see step 1) |
| **1** | **Synthetic handling fixtures + failure tags** in the bench harness | ⬜ **remaining** | needs a non-destructive injection seam + new judge tags — see below |

Steps 2–4 are behavior/data changes (explicitly outside the visual-only rule); the chip UI
uses shared primitives per `VISUAL_NORTH_STAR.md`.

**Step 1 remaining (the measurability unlock, intentionally deferred):** the bench reads
handling from a real anchored DB run (`run-bench.ts` → `buildEngineerChatContext`), so
controlled chip values require **one of**: (a) a `handlingOverrideByRunId` param threaded
`buildEngineerChatContext` → `buildEngineerRichContextV1` (clean, no data mutation), or
(b) an ephemeral synthetic Run row created + deleted per case. Not done here to avoid
mutating real run rows without sign-off. The `ignored_chips` / `over_trusted_rating`
failure tags also need adding to `calibratedJudge` `JudgeTag` + the judge rubric, then
mapped in `failureTaxonomy.ts` (`ignored_chips`→genericness, `over_trusted_rating`→
miscalibration). Until step 1 lands, the step-4 prompt change is **unmeasured**.

---

## Open / deferred

- **Positive / known-good chips** — capturing "great drive" as signal for known-good
  memory. Deferred; rating + feel-vs-last carry positives for now.
- **Feel-vs-last ±1** — quick pick stays 5 buckets (coarse-but-consistent); revisit only
  if drivers want finer deltas.
- **Auto-mode inference** feeding which chips to prompt for (practice vs race) — out of
  scope here; lives in the Engineer north star rollout.

---

**Changelog:**
- 2026-08-03 — **corner-balance capture rebuilt** (founder, four artifact rounds). The
  −3…+3 tap lane is replaced by one sealed instrument per phase: `[ understeer · | ·
  oversteer ]`, each pole a 44px zone carrying three tiles that rise toward the outside,
  flagged and escalated by the same tap-to-raise gesture the notable tiles use. Words are
  said once in a shared header; the centre pip is `0`/neutral, which two poles alone could
  not express. Fill is the **accent**, not destructive coral — balance describes what the
  car did rather than reporting a fault — and read-back drops to a monochrome ramp showing
  only the phases that were answered. **Balance speed tags retired from capture**, matching
  what was already done for traits. Storage is unchanged: signed −3…+3, `null` = not
  answered, `0` = neutral, so no migration and no Engineer read change.
- 2026-07-08 — initial draft from founder interview: traits → flag-if-notable chips,
  five survive (steering feel, on-power [new], braking [new], traction rolling,
  drivability), general character retired; speed tag on flagged issues; rating stays
  1–10 read as bands; synthetic bench fixtures prioritized as the measurability unlock.
  Founder approved + added braking to the chip set before build.
