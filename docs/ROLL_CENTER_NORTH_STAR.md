# Roll Center North Star

**Status:** **Locked** (founder approved via outline review, 2026-07-11 — "build what you've said"). **Owner:** Jordan.

The behavioral spec for **computed suspension geometry as a first-class setup signal** — geometric roll center, roll axis, and camber gain calculated automatically from every setup sheet, expressed honestly to the driver, and fed to the Engineer as deterministic evidence. When a geometry feature feels off-scope or an accuracy claim feels optimistic, check here.

---

## North star sentence

> **Every setup sheet knows its own geometry: the roll centers and roll axis compute themselves from the fields the driver already logs, deltas between runs are instrument-grade, and the Engineer quotes millimeters of geometric effect — never guessing at what a shim did.**

---

## Who it serves (founder, 2026-07-11)

Three doors, one engine — all equal: **the number** (RC becomes a real, trackable setup value like camber), **the history** (every run records how geometry moved and what it felt like), **the Engineer** (advice in real millimeters, not vague directions). Used trackside between runs, at home planning, and reviewing after events.

**Two kinds of drivers, by design:** the geometry-curious open the Lab and read the numbers; drivers who *just want the car better* never open any of it — for them the geometry works invisibly through the Engineer ("add 0.5mm under the front hubs" with the reasoning available but never required). **Geometry must never be required reading.**

**Ambition:** team weapon (one shared pack per car model; compare geometry across teammates at events), product differentiator (no other RC app computes real geometry from a logged sheet), and a headline feature for **every user soon** — more platform packs are a priority, not a maybe.

---

## The engine (built + validated — do not re-derive)

A 2D front-elevation kinematics engine already exists and is **cross-validated against VSUSP to 0.01mm** on the founder's measured Awesomatix A800R:

- **Model:** VSUSP-compatible hardpoint parameterization — frame mounts (from centerline + chassis bottom), ball-to-ball arm lengths, rigid knuckle (hub→ball offsets), wheel plane at hub + wheel offset, loaded tire radius (OD/2 − compression). Per side: 1-DOF four-bar solved by bisection (contact point on ground); ICs from arm-line intersection; RC from force-line intersection; camber = true wheel-plane lean (no KPI folding).
- **Computes:** static RC height F/R, roll-axis rake, static camber, camber gain (°/mm bump), RC migration under chassis roll (0–3° sweep), track width, per-shim RC sensitivities, and **true arm angles** — actual lower-arm and upper-link inclination in degrees, per axle.
- **Shim sensitivities are computed per setup, never tabulated (founder, 2026-08-13).** How much RC a stack moves depends on where the car already is — ride height, the stacks already fitted, tyre wear — so the engine derives it from the current solve every time. A table in a doc would be right at one operating point and quietly wrong everywhere else, and it would get quoted as truth. Measured 2026-08-13 on the A800R front axle: across ordinary states (ride height ±2mm, stacks already fitted, 60mm worn tyre) the same stack's mm-per-mm moves **7–18%**, though no sign flips. Under-hub is the one non-obvious sign: the shim raises the hub off the lower ball, so the ball sits *lower* in the knuckle frame; the engine wires that flip.
---

## Trust doctrine (the core founder ruling, 2026-07-11)

**Deltas are instrument-grade; absolutes carry a verification grade.** The VSUSP cross-check validated the *engine*, not the *measurements* — VSUSP contains the same hand measurements, so agreement proves the math while only CAD/manufacturer drawings certify the datums. Founder ruling: absolutes are "not 100% until CAD."

| Output | Trust | Why |
|---|---|---|
| **RC / rake deltas** (shim-to-shim, run-to-run) | Instrument-grade, no caveats | Depend on geometry *differences*, robust to datum error |
| **Shim sensitivities** (mm per mm) | Instrument-grade | Same reason — differences, not datums |
| **Absolute RC / rake / camber gain** | Labeled by **pack verification grade** | Hand measurement ≠ CAD certainty |

### Pack verification grades

Each platform pack carries a grade, shown as a small tag wherever absolutes render; **deltas never carry the tag**. Engineer wording follows the grade.

| Grade | Meaning |
|---|---|
| `measured` | Hand-measured hardpoints (calipers, stripped car) |
| `cross-checked` | Engine output matches an established external calculator (VSUSP) on this pack |
| `cad-verified` | Hardpoints confirmed against CAD / manufacturer drawings |

A800R launches at `cross-checked`.

---

## Data model

### Platform pack

A pack is per car model: every car using that sheet model inherits it, and the field→geometry mapping lives next to the fields it maps. **Authoring path: VSUSP share-link import** fills base hardpoints; an admin page manages the mapping. No code change per new car. The pack's shape and the field mapping live in `src/lib/rollCenter/packs.ts` and `computeFromSnapshot.ts` — the code is the contract, not a copy in this doc.

### What drives the calculation (all from the sheet)

| Input | Source | Effect |
|---|---|---|
| **Four shim stacks per axle** — Awesomatix names: **upper inner shims · under lower arm shims · upper outer shims · under hub shims** | Dedicated per-position sheet fields (already exist on the Awesomatix sheet; exact field keys still owed). **Free-typed total stack thickness in mm** — any increment (0.1, 0.25, whatever the driver runs); no step enumeration in the schema. UI: typed number input + 0.25-detent slider (founder rulings 2026-07-11) | Continuous hardpoint offsets. Under-hub is sign-inverted (raises hub → lower ball down in knuckle frame → RC up) |
| **Build choices** — chassis thickness, bulkhead upper-inner position parts | Sheet fields | Datum shift / discrete hardpoint moves |
| **Ride height** (per axle) | Sheet | Chassis heave (~1.2mm RC per mm) |
| **Camber** (per axle) | Sheet | Engine back-solves camber-link length from the recorded angle |
| **Tire diameter** (measured/worn) | Sheet / linked tire | Hub height — worn rubber (64→~60mm) moves RC |
| **Track width** | Sheet | Contact patch placement |

### Rulings the field mapping has to honour

The sheet field keys, the chassis thickness figures and the code↔material pairing live in `computeFromSnapshot.ts` and `packs.ts`. Copying them here only creates a second version to drift. What this doc owns is the two rulings behind them:

- **Per-leg shims average to one number.** The inner shim keys are per-leg (front/rear pin of each arm). Front-view RC uses the **mean of the two legs** — differential legging is side-view geometry (kick-up/anti) and out of scope, but the per-leg data is captured for the future side-view model.
- **Chassis thickness is a datum shift, not a ride-height change.** Mount heights are measured from the chassis **bottom**; parts bolt to its **top** — so a thickness change shifts every frame-relative z by Δthickness while ride height (ground → bottom) is set independently.

Excluded on purpose: bump-steer and toe-gain shim fields (a steering model someday) and diff internals.

### Missing data: compute with defaults, flag assumptions

Blank shim = 0, tire = nominal, etc.; the geometry block shows a small "assumed: …" note listing exactly what was defaulted. RC always exists; deltas between two sheets with the same gaps stay valid. Never block, never silently guess.

### Store computed results per setup document

RC F/R, rake, camber gain, and arm angles persist on (or derive cheaply from) each setup document — this is what makes compare surfaces, Engineer context, and aggregation queries cheap.

---

## Surfaces (all four approved)

| Surface | Content |
|---|---|
| **Setup sheet view** | **Collapsed by default (founder 2026-07-12):** a one-liner — front/rear RC + rake + grade tag — expanding on tap. Expanded: **clean-schematic front-view diagram** (arms, knuckle, wheel, ground line, RC marker; **arm angles labeled on the arms they measure**; no construction rays — those are Lab territory), front/rear toggle, camber gain **front and rear**, roll-axis strip, assumptions note, "Open in Lab" deep link. |
| **Run compare / setup compare** | RC + rake **delta chips** ("front RC +0.8mm") — neutral ink per the volume-delta rule; geometry deltas are direction, not good/bad. |
| **Run detail** | Compact geometry line — each run's record includes its computed RC state. |
| **Roll Center Lab** | The prototype ported as an Analysis-hub tool page: interactive diagram, shim sliders, live roll animation, charts, snapshot deltas. Deep-linked from every sheet's geometry block, loading that sheet as the starting state. |

**Roll axis expression:** side-view strip (front dot, rear dot, connecting line, heights labeled) + "rear +0.6mm higher — rakes down to front." Angle-in-degrees rejected (imperceptibly small numbers).

**Visual rules:** per `VISUAL_NORTH_STAR.md` — mono for all mm/° values, yellow only for the RC marker/actions in the Lab, green/red never used for geometry direction.

---

## Engineer integration

| Decision | Founder ruling |
|---|---|
| **When** | **Always** — every advice turn carries a compact geometry block for the run's setup. Max-context doctrine: the Engineer should never not-know the RC state. |
| **What** | Front/rear RC, roll-axis rake, camber gain, **deltas vs the previous run's setup**, pack verification grade. Summary scalars only — no raw sweep curves. |
| **Quantified predictions** | **Yes** — suggestions ship with the effect computed for *this* car's current geometry, never a remembered figure: "add 0.5mm lower-inner shim → front RC rises N.Nmm (geometric calc)." The geometry number is deterministic and stated flat; the *handling* outcome stays hedged per the confidence ladder. This is the prediction-discipline ideal: a checkable, physics-derived prediction on every geometry suggestion. |
| **Wording by grade** | `cross-checked`/`measured` packs: "geometric calc from your measured geometry"; `cad-verified`: stated flat. Never source names (VSUSP) in driver-facing answers — provenance stays in authoring records, per the KB provenance doctrine. |
| **Diagnostic use — conditions-aware (founder, 2026-07-11)** | Deeper than knowing the numbers: knowing **what the numbers should look like for the conditions.** The Engineer compares the driver's computed RC/rake against setups that tend to work in similar conditions — own history first, then team, then community aggregations of stored RC (bucketed by surface/grip, density-gated per the Engineer north star) — and flags meaningful outliers as candidate causes with a concrete move ("your front RC is well below what works in high grip here — worth trying +0.5mm under the front hubs"). Same soft-prior rules as the community position policy: named and reasoned, never silently normalized toward the field. |
| **UI links — all four approved (founder, 2026-07-12)** | (1) **Auto-context** — as spec'd above, no UI, the Engineer just always knows. (2) **"Ask the Engineer"** from the expanded geometry block and the Lab → opens chat pre-anchored to that sheet's geometry. (3) **Suggestions open in Lab** — when the Engineer proposes a shim change, the reply deep-links to the Lab preloaded with that change so the driver sees the geometry move. (4) **Lab what-if handoff** — from the Lab, send the current tweaked state to chat ("would this geometry help my mid-corner push?"). |

KB note: `content/vehicle-dynamics/` roll-centre prose exists for *mechanism*; the computed numbers are *this driver's geometry* — a new evidence tier the Engineer cites as "your own setup's geometry." A drafts-tier physics file on roll axis / camber gain may accompany the build (drafts tier is pre-authorized; top-level KB stays gated).

---

## Community aggregation (design now, ship later)

RC height is **car-independent physics** — −9mm front RC means the same thing on an Awesomatix, Xray, or Mugen. Once a second platform pack exists, computed RC becomes the first genuinely **cross-platform** setup parameter ("the field at this track runs front RC −8 to −10mm"), where today's universal params (toe, camber) only compare values, not geometries.

**v1 obligation:** store computed RC per setup document so aggregation is a query away. No aggregation UI until multiple packs exist and the standard density gates apply (`sampleCount` trust rules from the Engineer north star).

---

## Rollout

| Phase | Scope | Gate | Status |
|:--:|---|---|---|
| **0** | Prototype engine + A800R pack + VSUSP cross-validation + this doc | Founder locks doc | ✅ 2026-07-11 |
| **1** | **Engine + pack into the app** — engine in `src/lib/rollCenter/` with node tests, VSUSP import, Awesomatix pack + field mapping; real arm angles replace the shim-difference index proxies in aggregations | Unit tests reproduce the VSUSP cross-check exactly | ✅ 2026-07-11. **Live deviation:** the pack ships as a typed code registry, not a `SetupSheetModel` column — the column and the admin VSUSP import land with the second platform. |
| **2** | **Passive surfaces** — setup sheet geometry block (grade tag, assumption notes, roll-axis strip), run detail line, compare delta chips | Founder reads a real sheet's geometry block and trusts it | ✅ **Gate passed 2026-07-12** — founder read it on phone: "trust it". The history-table compact line stays deferred; the sheet modal carries the block. |
| **2.5** | **Viewing-experience rework (founder 2026-07-12)** — sheet block **collapses to the RC + rake one-liner** (RC F/R · rake · grade tag), tap to expand; expanded view gains the **clean-schematic front-view diagram** (front/rear toggle, arm angles labeled on the arms, RC marker) + camber gain **front and rear**. Diagram component shared with the Lab. | Founder gets useful info faster on phone than the v1 block | 🟡 Built 2026-07-12. Founder phone check pending. |
| **3** | **Roll Center Lab** — Analysis tool page: interactive diagram, shim sliders, chassis pose (roll + bump), charts, snapshot deltas; "Open in Lab" deep links seed it from a sheet. **Scope expanded (founder 2026-07-12): + two-setup ghost compare** (second sheet as overlay in the same diagram) **+ Lab state → draft setup export** (the what-if becomes a runnable setup — the Lab is deliberately not read-only) | Lab loads any Awesomatix sheet's state correctly | 🟡 Built 2026-07-12; **bump pose slider + sharper line/marker treatment 2026-08-13**; **desktop layout 2026-08-13** — one column below 1280, then knobs \| drawing \| readouts, the third track appearing at 1400 (`.lab-grid` in globals.css, page on `.lab-wide` = the 1760px axis). The schematic is capped by HEIGHT on desktop, not aspect, so the roll-centre numbers stay on screen while a knob is turned. Founder phone check pending. |
| **4** | **Engineer wiring** — compact geometry block in rich context; quantified geometric predictions in suggestions; grade-aware wording; **conditions-aware RC position evidence** (vs own history/team/community per the diagnostic-use row — community leg activates as Phase 5 density allows); **all four UI links** (see Engineer-integration table): ask-from-geometry-surfaces, suggestions-open-in-Lab, Lab what-if handoff | Bench: geometry-question cases cite computed values correctly; a low-RC-for-conditions bait case gets caught; no regression on the 30-case set | ⬜ after 3 |
| **5** | **Community layer** — aggregation over stored RC values once a second platform pack exists | Second pack authored + density gate | ⬜ |

**Legend:** ✅ done · 🟡 partial · ⬜ not started

**Sequencing rule (updated, founder 2026-07-12):** 2.5 → 3 → 4, in that order. The three doors stay equally important long-term ("it's all as important as each other"), but the near-term focus is **making useful info as easy as possible to get from the new tool** (viewing experience) with the **Engineer link and the Lab both first-class** — front-view only for now; side-view/full-car remain future directions.

---

## Future directions (saved for later — founder, 2026-07-11)

Explicitly **not v1**, explicitly **wanted eventually**. Don't build these now; don't design v1 in a way that blocks them.

| Direction | Founder ruling |
|---|---|
| **Full-car geometry model** — steering, bump steer, toe gain, everything | **"The true north star."** The per-leg shim keys, bump-steer / toe-gain fields, and steering fields are already captured on sheets — the data pipeline for this exists today. |
| **Side-view geometry** (anti-dive / anti-squat, caster) | "Could be great." Same pack concept, side elevation; also the #1-ranked KB gap. The per-leg (ff/fr) shim data v1 averages away is exactly what this model needs. |
| **Force-based / dynamic roll center** | "Isn't something currently used, but could be amazing." Needs tire models + CG data; a differentiator beyond what any RC pit tool does. |

## Non-goals

| Not the goal | Why |
|---|---|
| Suspensions beyond double wishbone | TC first, per the KB layering rule (nail touring car, design for later disciplines). |
| Guided caliper measurement of assembled cars | Hybrid sourcing means packs come from stripped-car measurement / VSUSP / drawings; measuring a built car to 0.1mm isn't real. |

---

## Success signals (founder-confirmed 2026-07-11 — all four)

- **VSUSP retired:** geometry lives where the runs live; the founder stops opening the external tool.
- **A real decision changed:** at least once at a real race, the RC number or the Engineer's geometry-grounded advice picks a different change than gut would have.
- **Understanding grows:** shim choices stop being folklore — the founder (and geometry-curious users) know what their stacks actually do.
- **Teammates want in:** other Awesomatix drivers see it and ask for it; a second platform pack gets authored via VSUSP import without code changes.
- Guardrail: Engineer geometry-cited answers rate well in the quality loop; zero wrong-direction shim claims (they're deterministic now).

---

## Open items

| Item | Owner |
|---|---|
| Bulkhead upper-inner position option table (which parts → which x/z offsets) | Jordan — "not sure for now" (2026-07-11); ships without it, flagged as an assumption when relevant |
| CAD/drawing source for `cad-verified` upgrade | Jordan / Awesomatix contact |

_History lives in git. This doc carries only what is currently true._
