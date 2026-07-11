# Roll Center North Star

**Status:** Draft for founder review — becomes **locked** once Jordan edits and approves. **Owner:** Jordan.

The behavioral spec for **computed suspension geometry as a first-class setup signal** — geometric roll center, roll axis, and camber gain calculated automatically from every setup sheet, expressed honestly to the driver, and fed to the Engineer as deterministic evidence. When a geometry feature feels off-scope or an accuracy claim feels optimistic, check here.

Sources: founder interviews 2026-07-10 + 2026-07-11 (four structured rounds) + working prototype validated against the founder's VSUSP project (same sessions).

---

## North star sentence

> **Every setup sheet knows its own geometry: the roll centers and roll axis compute themselves from the fields the driver already logs, deltas between runs are instrument-grade, and the Engineer quotes millimeters of geometric effect — never guessing at what a shim did.**

---

## The engine (built + validated — do not re-derive)

A 2D front-elevation kinematics engine already exists and is **cross-validated against VSUSP to 0.01mm** on the founder's measured Awesomatix A800R:

- **Model:** VSUSP-compatible hardpoint parameterization — frame mounts (from centerline + chassis bottom), ball-to-ball arm lengths, rigid knuckle (hub→ball offsets), wheel plane at hub + wheel offset, loaded tire radius (OD/2 − compression). Per side: 1-DOF four-bar solved by bisection (contact point on ground); ICs from arm-line intersection; RC from force-line intersection; camber = true wheel-plane lean (no KPI folding).
- **Computes:** static RC height F/R, roll-axis rake, static camber, camber gain (°/mm bump), RC migration under chassis roll (0–3° sweep), track width, per-shim RC sensitivities.
- **Validation:** VSUSP displays −9.1 F / −8.5 R for "A800R No Shims - STEEL"; engine computes **−9.09 / −8.50**. Overall width reproduces at 188.7mm; static camber at −1.78°. 128/128 extreme-input combinations solve.
- **A800R shim sensitivities (mm RC per mm of stack, Awesomatix position names — founder 2026-07-11):** under lower arm **+2.2** · under hub **+2.1** · upper inner **−1.0** · upper outer **+1.0** · ride height +1mm → RC +1.2 vs ground. (Under-hub shims raise the hub off the lower ball → lower ball moves *down* in the knuckle frame → RC rises; the engine wires this sign flip.)
- **VSUSP URL parser:** share-link fragments decode at mm×1000 for *every* value — including `tires.compression` (125 → 0.125mm squash, **not** a percent; this was the one decode bug found and fixed during validation).

Prototype (interactive, app-styled): https://claude.ai/code/artifact/acd0774d-d38d-4ae0-b8e6-eafefbdbd100 · engine + node test harness in the 2026-07-11 session scratchpad (`roll-center-prototype.html`, `engine-test.js`).

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

### Platform pack — JSON on `SetupSheetModel`

The pack attaches to the setup sheet model (car-model level): every car using that sheet model inherits it, and the field→geometry mapping lives next to the fields it maps. **Authoring path: VSUSP share-link import** fills base hardpoints; an admin page manages the mapping. No code change per new car.

```
pack = {
  verificationGrade, vsuspUrl,
  front / rear: { base hardpoints (VSUSP parameterization) },
  mapping: [
    { fieldKey, effect: hardpoint + axis + scale },          // shim fields → continuous offsets
    { fieldKey, positions: { code → hardpoint x/z } },       // discrete position parts (bulkhead upper-inner options)
    { fieldKey, effect: datumShift }                          // chassis thickness → z-datum shift on all frame-relative points
  ]
}
```

### What drives the calculation (all from the sheet)

| Input | Source | Effect |
|---|---|---|
| **Four shim stacks per axle** — Awesomatix names: **upper inner shims · under lower arm shims · upper outer shims · under hub shims** | Dedicated per-position sheet fields (already exist on the Awesomatix sheet; exact field keys still owed). **Free-typed total stack thickness in mm** — any increment (0.1, 0.25, whatever the driver runs); no step enumeration in the schema. UI: typed number input + 0.25-detent slider (founder rulings 2026-07-11) | Continuous hardpoint offsets. Under-hub is sign-inverted (raises hub → lower ball down in knuckle frame → RC up) |
| **Build choices** — chassis thickness, bulkhead upper-inner position parts | Sheet fields | Datum shift / discrete hardpoint moves |
| **Ride height** (per axle) | Sheet | Chassis heave (~1.2mm RC per mm) |
| **Camber** (per axle) | Sheet | Engine back-solves camber-link length from the recorded angle |
| **Tire diameter** (measured/worn) | Sheet / linked tire | Hub height — worn rubber (64→~60mm) moves RC |
| **Track width** | Sheet | Contact patch placement |

### Awesomatix field map (recovered from the calibration DB, 2026-07-11)

The A800R/RR calibrations (`SetupSheetCalibration.calibrationDataJson.formFieldMappings`) already carry every key the mapping needs — identical keys across all three calibrations (A800RR-Old_V1.0, A800RR_New_V1.0, A800R Old_V1.1):

| Engine input | Sheet field key(s) | Note |
|---|---|---|
| Under lower arm shims | `under_lower_arm_shims_ff` / `_fr` (front) · `_rf` / `_rr` (rear) | **Per-leg** (front/rear pin of each arm). Front-view RC uses the **mean of the two legs**; differential legging is side-view geometry (kick-up/anti) — out of scope here, but the data is already captured for the future side-view model. |
| Upper inner shims | `upper_inner_shims_ff` / `_fr` · `_rf` / `_rr` | Same per-leg structure, same mean rule. |
| Under hub shims | `under_hub_shims_front` / `_rear` | Per axle. Sign-inverted (see above). |
| Upper outer shims | `upper_outer_shims_front` / `_rear` | Per axle. |
| Chassis (datum shift) | `chassis` — single choice: `C01RS` / `C01B-RC` / `C01B-RAF` (+ `chassis_other` free text) | Thickness table below. |
| Lower arm length | `lower_arm_extension_front` / `_rear` | Arm-length option parts → `lowerLen` adjustment. |
| Track / wheel plane | `wheel_spacer_front` / `_rear` | Adds to wheel offset. |
| Not RC inputs | `bump_steer_shims_front`, `toe_gain_shims_rear`, `diff_shims` | Steering/toe link heights (bump-steer model someday), diff internals — excluded. |

### Chassis thickness table (founder, 2026-07-11)

Mount heights are measured from the chassis **bottom**; parts bolt to its **top** — so a thickness change shifts every frame-relative z by Δthickness while ride height (ground → bottom) is set independently.

| Chassis | Thickness | Datum shift vs pack base |
|---|---|---|
| Steel | 1.2 mm | **0 (pack base — the VSUSP project was measured on steel)** |
| Alu | 2.0 mm | +0.8 mm on all frame mounts |
| Carbon | 2.2 mm | +1.0 mm on all frame mounts |

Sheet codes confirmed (founder, 2026-07-11): `C01RS` = steel · `C01B-RC` = carbon · `C01B-RAF` = alu.

### Missing data: compute with defaults, flag assumptions

Blank shim = 0, tire = nominal, etc.; the geometry block shows a small "assumed: …" note listing exactly what was defaulted. RC always exists; deltas between two sheets with the same gaps stay valid. Never block, never silently guess.

### Store computed results per setup document

RC F/R, rake, camber gain persist on (or derive cheaply from) each setup document — this is what makes compare surfaces, Engineer context, and future aggregation queries cheap.

---

## Surfaces (all four approved)

| Surface | Content |
|---|---|
| **Setup sheet view** | Geometry stat block: front RC, rear RC, roll axis (side-view mini-diagram + mm rake), camber gain; verification-grade tag on absolutes; assumption note when fields were defaulted. "Open in Lab" deep link. |
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
| **Quantified predictions** | **Yes** — suggestions ship with the computed effect: "add 0.5mm lower-inner shim → front RC rises ~1.1mm (geometric calc)." The geometry number is deterministic and stated flat; the *handling* outcome stays hedged per the confidence ladder. This is the prediction-discipline ideal: a checkable, physics-derived prediction on every geometry suggestion. |
| **Wording by grade** | `cross-checked`/`measured` packs: "geometric calc from your measured geometry"; `cad-verified`: stated flat. Never source names (VSUSP) in driver-facing answers — provenance stays in authoring records, per the KB provenance doctrine. |
| **Diagnostic use** | RC state is context for balance diagnosis ("your front RC is ~2mm lower than your usual") — same cross-axle-check pattern as community position policy. |

KB note: `content/vehicle-dynamics/` roll-centre prose exists for *mechanism*; the computed numbers are *this driver's geometry* — a new evidence tier the Engineer cites as "your own setup's geometry." A drafts-tier physics file on roll axis / camber gain may accompany the build (drafts tier is pre-authorized; top-level KB stays gated).

---

## Community aggregation (design now, ship later)

RC height is **car-independent physics** — −9mm front RC means the same thing on an Awesomatix, Xray, or Mugen. Once a second platform pack exists, computed RC becomes the first genuinely **cross-platform** setup parameter ("the field at this track runs front RC −8 to −10mm"), where today's universal params (toe, camber) only compare values, not geometries.

**v1 obligation:** store computed RC per setup document so aggregation is a query away. No aggregation UI until multiple packs exist and the standard density gates apply (`sampleCount` trust rules from the Engineer north star).

---

## Rollout

| Phase | Scope | Gate | Status |
|:--:|---|---|---|
| **0** | Prototype engine + A800R pack + VSUSP cross-validation + this doc | Founder locks doc | 🟡 Engine validated 2026-07-11; doc awaiting founder lock |
| **1** | **Engine + pack into the app** — port engine to `src/lib/rollCenter/` with the node tests, pack JSON schema on `SetupSheetModel`, VSUSP import, Awesomatix pack + field mapping (needs founder's shim step sizes + field keys) | Unit tests reproduce the VSUSP cross-check exactly | ⬜ |
| **2** | **Passive surfaces** — setup sheet geometry block (grade tag, assumption notes, roll-axis strip), run detail line, compare delta chips | Founder reads a real sheet's geometry block and trusts it | ⬜ |
| **3** | **Roll Center Lab** — port the artifact to an Analysis tool page; "Open in Lab" deep links seed it from a sheet | Lab loads any Awesomatix sheet's state correctly | ⬜ |
| **4** | **Engineer wiring** — compact geometry block in rich context; quantified geometric predictions in suggestions; grade-aware wording | Bench: geometry-question cases cite computed values correctly; no regression on the 30-case set | ⬜ |
| **5** | **Community layer** — aggregation over stored RC values once a second platform pack exists | Second pack authored + density gate | ⬜ |

**Legend:** ✅ done · 🟡 partial · ⬜ not started

**Sequencing rule:** build is **scheduled, not started** (founder ruling 2026-07-11) — slots against the pillar stack like other Tier-C+ features; phases 1–2 are the meaningful unit to schedule together (engine without surfaces is invisible).

---

## Non-goals

| Not the goal | Why |
|---|---|
| Side-view geometry (anti-dive / anti-squat, caster) | Separate model; natural later extension of the same pack — and the #1 ranked KB gap, so it's a *future* candidate, not v1 scope. |
| Force-based / dynamic roll center | Load-dependent migration needs tire models and CG data; geometric RC + kinematic roll sweep is the honest deliverable. |
| CG height / roll-moment displays | Requires a CG estimate we don't have; rejected in interview. |
| Suspensions beyond double wishbone | TC first, per the KB layering rule (nail touring car, design for later disciplines). |
| Guided caliper measurement of assembled cars | Hybrid sourcing means packs come from stripped-car measurement / VSUSP / drawings; measuring a built car to 0.1mm isn't real. |

---

## Success signals

- Founder makes a shim decision at a race meeting using the sheet geometry block or Lab (not VSUSP).
- Engineer geometry-cited answers rate well in the existing quality loop; zero wrong-direction shim claims (they're deterministic now).
- A second platform pack gets authored via VSUSP import without code changes.

---

## Open items

| Item | Owner |
|---|---|
| ~~Exact sheet field keys~~ | **Resolved 2026-07-11** — recovered from the calibration DB (table above). ~~Step sizes~~ resolved: free-typed mm, no steps |
| ~~Confirm chassis code↔material pairing~~ | **Resolved 2026-07-11**: RS = steel, RC = carbon, RAF = alu |
| Bulkhead upper-inner position option table (which parts → which x/z offsets) | Jordan — "not sure for now" (2026-07-11); Phase 1 ships without it, flagged as an assumption when relevant |
| CAD/drawing source for `cad-verified` upgrade | Jordan / Awesomatix contact |
| Doc lock | Jordan |

**Changelog:** 2026-07-11 initial draft from founder interviews (four rounds) + validated prototype · 2026-07-11 shim stacks ruled free-typed mm (no step enumeration); slider keeps 0.25 detents · 2026-07-11 Awesomatix field map recovered from calibration DB (per-leg inner shim keys; lower-arm extensions + wheel spacers added as inputs); chassis thickness table (steel 1.2 base / alu 2.0 / carbon 2.2).
