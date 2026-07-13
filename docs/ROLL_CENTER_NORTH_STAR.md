# Roll Center North Star

**Status:** **Locked** (founder approved via outline review, 2026-07-11 — "build what you've said"). **Owner:** Jordan.

The behavioral spec for **computed suspension geometry as a first-class setup signal** — geometric roll center, roll axis, and camber gain calculated automatically from every setup sheet, expressed honestly to the driver, and fed to the Engineer as deterministic evidence. When a geometry feature feels off-scope or an accuracy claim feels optimistic, check here.

Sources: founder interviews 2026-07-10 + 2026-07-11 (four structured rounds) + working prototype validated against the founder's VSUSP project (same sessions).

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

RC F/R, rake, camber gain, and arm angles persist on (or derive cheaply from) each setup document — this is what makes compare surfaces, Engineer context, and aggregation queries cheap.

### Real arm angles retire the index proxies (founder, 2026-07-11)

`src/lib/setupAggregations/setupGeometryDerivedMetrics.ts` currently ships `derived_upper_link_index_*_mm` and `derived_lower_link_index_*_mm` — shim-difference proxies that *guess* at arm angle. The engine computes the **actual angles**. Phase 1 adds `derived_lower_arm_angle_{front,rear}_deg` and `derived_upper_link_angle_{front,rear}_deg` computed from the solved geometry; they join the sheet geometry block, tuning comparison keys, and aggregations. The mm indices retire once the angle keys cover their uses (update `tuningComparisonKeys.ts` + `parameterClassificationOverrides.ts` in the same pass) — the angle is what the index was always trying to say, made clear.

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
| **Quantified predictions** | **Yes** — suggestions ship with the computed effect: "add 0.5mm lower-inner shim → front RC rises ~1.1mm (geometric calc)." The geometry number is deterministic and stated flat; the *handling* outcome stays hedged per the confidence ladder. This is the prediction-discipline ideal: a checkable, physics-derived prediction on every geometry suggestion. |
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
| **0** | Prototype engine + A800R pack + VSUSP cross-validation + this doc | Founder locks doc | 🟡 Engine validated 2026-07-11; doc awaiting founder lock |
| **1** | **Engine + pack into the app** — port engine to `src/lib/rollCenter/` with the node tests, pack JSON schema, VSUSP import, Awesomatix pack + field mapping | Unit tests reproduce the VSUSP cross-check exactly | ✅ 2026-07-11 — `src/lib/rollCenter/` (engine, vsusp, packs, computeFromSnapshot), 11 tests green (`npm run test:roll-center`), incl. VSUSP cross-check to ±0.02mm and a datum-robustness proof of the delta doctrine. **Deviation:** pack ships as a typed code registry (same JSON shape), not a DB column — avoids a prod-risk migration; the `SetupSheetModel` column + admin VSUSP import land with the second platform. Derived keys (`derived_roll_center_*_mm`, `derived_roll_axis_rake_mm`, `derived_*_angle_*_deg`) replaced the index proxies in `setupGeometryDerivedMetrics.ts` / `tuningComparisonKeys.ts` / `parameterClassificationOverrides.ts`; Engineer prompt paragraph rewritten (`openaiEngineer.ts` DERIVED COMPUTED GEOMETRY). **Post-ship:** run `POST /api/setup-aggregations/rebuild` so aggregations pick up the new keys. |
| **2** | **Passive surfaces** — setup sheet geometry block (grade tag, assumption notes, roll-axis strip), run detail line, compare delta chips | Founder reads a real sheet's geometry block and trusts it | ✅ **Gate passed 2026-07-12** — founder read it on phone: "trust it". Committed `89def68`. `RollCenterGeometryBlock` at the top of every `SetupSheetView`; `RollCenterCompareStrip` in `RunComparePanel`. History-table compact line stays deferred (sheet modal carries the block). **Still owed: `POST /api/setup-aggregations/rebuild`** (stored rows carry the retired index keys). |
| **2.5** | **Viewing-experience rework (founder 2026-07-12)** — sheet block **collapses to the RC + rake one-liner** (RC F/R · rake · grade tag), tap to expand; expanded view gains the **clean-schematic front-view diagram** (front/rear toggle, arm angles labeled on the arms, RC marker) + camber gain **front and rear**. Diagram component shared with the Lab. | Founder gets useful info faster on phone than the v1 block | 🟡 **Built + headless-verified 2026-07-12** — `AxleSchematic` (shared SVG, draws the engine's actual solve; yellow RC diamond is the one accent mark), block reworked to collapsed→expanded with `SegmentedControl` front/rear toggle + camber gain F/R; arm-angle text grid retired (angles live on the arms). New `solveRollCenterDiagram` export + consistency test (12/12 green). Verified via CDP screenshots on a real A800RR run's sheet modal at 390px (collapsed / front / rear). Founder phone check pending. |
| **3** | **Roll Center Lab** — port the artifact to an Analysis tool page (interactive diagram, shim sliders, roll animation, charts, snapshot deltas — refresh the stale artifact: camber auto-match, not the manual slider); "Open in Lab" deep links seed it from a sheet. **Scope expanded (founder 2026-07-12): + two-setup ghost compare** (second sheet as overlay in the same diagram) **+ Lab state → draft setup export** (the what-if becomes a runnable setup — the Lab is deliberately not read-only) | Lab loads any Awesomatix sheet's state correctly | 🟡 **Built + headless-verified 2026-07-12.** `/analysis/roll-center` (Analysis-hub `flask` door) + `RollCenterLabClient`: shared `AxleSchematic` live diagram, per-axle knob rows (0.25-detent slider + free-typed mm; per-leg keys equalized on edit; camber auto-match preserved, shown as magnitude), ride height, chassis segmented; roll slider + ping-pong animation (0–3°) with RC height+lateral readout; **RC migration path chart** (same-unit mm/mm plane — no dual axis); computed shim-sensitivity table; delta chips vs loaded sheet. **Ghost:** `?g=` seed, "Set ghost = current" freeze, dashed overlay + hollow RC diamond in diagram and chart. **Export:** change list → clipboard + "Log run with this setup" → `/runs/new?labSetup=…` (new `NewRunForm` prefill: merges geometry fields over the starting setup, re-applies after copy-last-run, disables draft autosave). **Links:** "Open in Lab" in the expanded sheet block (baseline rides along as ghost), "Compare in Lab" in the compare strip. State = sheet vocabulary via `labState.ts` codec (base64url, key-allowlisted). Gate verified via CDP: seeded from a real A800RR run (RC −5.3/−4.8 reproduced), export produced the geometry block on `/runs/new`. SSR hydration lesson: quantize SVG coords (server/client libm differ 1 ulp). Founder phone check pending. |
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
| ~~Exact sheet field keys~~ | **Resolved 2026-07-11** — recovered from the calibration DB (table above). ~~Step sizes~~ resolved: free-typed mm, no steps |
| ~~Confirm chassis code↔material pairing~~ | **Resolved 2026-07-11**: RS = steel, RC = carbon, RAF = alu |
| Bulkhead upper-inner position option table (which parts → which x/z offsets) | Jordan — "not sure for now" (2026-07-11); Phase 1 ships without it, flagged as an assumption when relevant |
| CAD/drawing source for `cad-verified` upgrade | Jordan / Awesomatix contact |
| ~~Doc lock~~ | **Resolved 2026-07-11** — locked |
| ~~`POST /api/setup-aggregations/rebuild`~~ | **Resolved 2026-07-12** — founder ran the rebuild; arm-angle + RC derived keys confirmed flowing through both aggregation paths (`geometryDerivedScalarObservations`), link-index code fully gone from `src/` |

**Changelog:** 2026-07-11 initial draft from founder interviews (four rounds) + validated prototype · 2026-07-11 shim stacks ruled free-typed mm (no step enumeration); slider keeps 0.25 detents · 2026-07-11 Awesomatix field map recovered from calibration DB (per-leg inner shim keys; lower-arm extensions + wheel spacers added as inputs); chassis thickness table (steel 1.2 base / alu 2.0 / carbon 2.2) · 2026-07-11 goal section + all-four success signals (founder-confirmed); "geometry never required reading" principle · 2026-07-11 true arm angles retire the link-index proxies; Phase 4 upgraded to conditions-aware RC position evidence (founder) · 2026-07-11 doc locked ("build what you've said"); future-directions section added (full-car geometry = true north star) · 2026-07-11 Phases 1–2 built: engine + tests + derived-key swap + sheet geometry block + compare strip (see rollout table) · **2026-07-12 Phase 2 gate PASSED** (founder read it on phone — "trust it"); committed `89def68`; founder interview (two rounds) added **Phase 2.5 viewing-experience rework** (collapsed RC+rake one-liner → expandable clean-schematic diagram, angles on the arms, camber gain F+R), expanded Lab scope (ghost compare + draft-setup export), approved **all four Engineer UI links**, and set sequencing 2.5 → 3 → 4 · 2026-07-12 aggregations rebuilt by founder (derived geometry keys live) · 2026-07-12 **Phase 2.5 built** (`AxleSchematic` + collapsed/expanded block rework, 12 tests, CDP-verified at 390px), founder phone check pending · 2026-07-12 **Phase 3 built** (Lab page + ghost compare + labSetup export into /runs/new + Open-in-Lab links, 14 tests, CDP end-to-end incl. seed + export legs), founder phone check pending.
