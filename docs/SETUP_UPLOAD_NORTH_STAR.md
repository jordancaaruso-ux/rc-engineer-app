# Setup Upload North Star — any sheet, accurate every time

**Status:** Locked from founder interview (2026-07-06); public-release strategy added 2026-07-20. **Owner:** Jordan.

Governs the setup-sheet upload/extraction system. Sits under `PRODUCT_NORTH_STAR.md`
(pillar 7 — garage & catalog; enables the 6-month "seamless to add new car models"
horizon). Visual work on these screens follows `VISUAL_NORTH_STAR.md`.

---

## One sentence

> Any setup sheet a driver can get their hands on — editable AcroForm PDF, flattened
> text PDF, crisp image of a digital sheet, eventually a phone photo — uploads and
> extracts accurately, with new sheet styles bootstrapped by AI vision instead of
> waiting for someone to hand-build a calibration.

## The problem today

Extraction only works for AcroForm PDFs **after** a manual calibration exists for that
car's sheet style. Many brands publish setup sheets as images of PDFs; those need a
hand-drawn region calibration first. New brand = dead end until an admin calibrates.

---

## Locked decisions (founder interview 2026-07-06)

| Decision | Call |
|---|---|
| **Architecture** | AI-first extraction for uncalibrated documents; confirmed extractions **become** auto-generated calibrations (self-building cache). Staged — see below. |
| **Trust model** | Confidence-gated review: high-confidence fields import directly; review screen opens focused on flagged fields only. Never silently import a low-confidence value. |
| **Review UX** | Evidence crop per flagged field — the actual source pixels shown next to the extracted value. Glance, confirm or fix, next. |
| **Formats in scope** | AcroForm PDFs (works, keep) · flattened/text-only PDFs · crisp images of digital sheets — all must be nailed. Phone photos of paper sheets: in scope **only if** they clear the eval bar; otherwise cut without guilt. |
| **New brands** | AI drafts the sheet model schema (fields, sections, types) from an unknown sheet, for review — schema creation stops being a manual admin bottleneck. |
| **Sharing** | Tiered — see "Governance" below. Calibrations: private → team (immediate) → global (admin-curated). Schemas: stricter, admin-approved before anyone else builds on them. |
| **Quality bar** | Gold-set eval per format with hand-verified expected values; field-level accuracy scoring. A format ships when ≥95% of fields are **correct-or-flagged** (a wrong value presented as confident is the only real failure). |
| **Cost** | Accuracy first. LLM-per-upload in Stage 1 is acceptable (pennies at current volume); Stage 2 makes repeat styles cheap. |
| **Legacy path** | Existing manual calibration system (editor, fingerprint auto-pick, bulk import) stays untouched alongside. AI path is additive: runs when no calibration matches. |

### Refinement — template creation is AcroForm-anchored (2026-07-08)

The "AI drafts the schema from an unknown sheet" decision above splits into **two distinct techniques** — do not conflate them:

- **Template creation (the reusable sheet model + calibration) — AcroForm-anchored, required.** The editable AcroForm PDF supplies exact box count, position, and structural type; AI vision only reads labels / purpose / option text *at those known locations*. This is the only way a template is built. A PDF with no form fields is **rejected** — pure-image template creation is not reliable enough ("the AI does its own thing" — miscounts and misplaces boxes) and is out of scope.
- **One-off value extraction — pure-vision fallback only.** The unconstrained image→schema AI (`draftSetupSheetModelSchema`) stays a best-effort fallback for reading a single *uncalibrated* upload; it never builds the reusable template.

Full design (upload-first wizard, manual mapping with auto type/group detect, car decoupling, draw-fields removal): interview 2026-07-08 + memory `setup-template-creation-rework`.

### Supersedes the above — template creation is hand-built, box-first (2026-07-22)

The AI **naming** pass never survived review: the founder renamed every drafted parameter, so the
draft cost more than it saved. The in-app AI template wizard (`/setup-sheet-models/new/setup`,
`CarSetupWizardClient`, `POST /api/setup-sheet-models/draft-from-pdf`) is **deleted**.

- **Template creation is the mapping editor.** `/setup-sheet-models/new` takes a name + the blank
  PDF, creates the chassis type with an **empty** schema and an empty AcroForm calibration, and
  lands in `/setup-calibrations/<id>`. Every parameter is created by clicking its box on the sheet
  and naming it there (free-text group, optional universal parameter, one-of-many/many-of-many built
  by clicking several boxes). Arranging the rendered sheet is the *next* step, in the schema editor.
- **The AcroForm geometry is still the anchor** — the boxes come from the PDF's own form fields
  (`/api/setup-documents/[id]/pdf-form-fields`), not from a model. Nothing about the reading engine
  changed; only who names the fields.
- **`draftCalibrationFromBlankSheet` survives as offline tooling** —
  `scripts/setup-extract-eval/blank-calibration-pilot.ts` + the self-verify loop still use it, and
  `draftSetupSheetModelSchema` remains the uncalibrated-upload fallback below. Neither is reachable
  from the app UI.

#### Positions: one stem, several parameters (2026-07-25)

Typing the position on every box was most of the typing on a paired/per-corner sheet, and the
easiest way to end up with a label that breaks grouping. The naming panel gained a **Positions**
row — `Single · Front/Rear · FF/FR/RF/RR`.

- **Siblings, not a group.** `Camber` + Front/Rear creates `camber_front` **and** `camber_rear`
  ("Camber (Front)" / "Camber (Rear)"), one box each, in one schema PATCH. Grouped
  (`one_of_many`/`many_of_many`) still means *these boxes are one parameter's options* and remains
  the `Single` meaning — everything downstream (the flat snapshot map, the universal registry, the
  per-axle Engineer notes) is per-position, so a grouped parameter would be the wrong shape.
- **No layout metadata is written.** The generated `_front`/`_rear`/`_ff`/`_fr`/`_rf`/`_rr` suffixes
  are exactly what `layoutGroupOps` infers pair/corner4 rows from, so the schema editor groups them
  with no extra state. The suffix is load bearing: `buildPositionSplitFields` **refuses** a
  collision rather than letting `uniqueParameterKey` emit `camber_front_2`.
- **Universal ids per position, and never for corners.** Front/Rear derives each sibling's id from
  its own generated label, so a split gets cross-car pooling that the old grouped path suppressed
  entirely. Corners get none on purpose — `detectAxle` reads the `FR` in "Camber (FR)" as *front*
  and would book one inner pickup stack as the whole front axle, and the registry has no per-corner
  ids anyway.
- **Boxes are slot-addressed while a split is active.** `pendingBoxKeys` is fixed to the split's
  length with `null` for unfilled positions; a sheet click fills the next empty slot, re-clicking a
  filled one clears it. Saving with slots empty still creates all N parameters — the unmapped ones
  appear under the sidebar's "Unmapped" filter.
- **The Name box suggests stems** — names already on this sheet first, then the 8 universal
  concepts; picking one pre-selects its split. Built on `AnchoredMenu`, which already handles the
  two iOS faults that retired the old custom comboboxes (visual-viewport re-pin when the keyboard
  opens, touch scroll-lock).
- **Considered and left out:** `Left/Right` (not a `LayoutGroupRole`, so nothing downstream would
  group it) and custom 2–6 slot labels.

#### Yes/no boxes and positions × options (2026-07-25)

Two gaps closed the same day the split landed, both hit by real touring sheets.

- **A lone tick box is now a type.** `checkbox` joins `NewParameterKind` → `{valueType: "boolean",
  uiType: "checkbox"}`, the same shape `buildFieldDefFromKind` already emitted for the schema
  editor, and the sheet already rendered (`buildSetupSheetTemplate` maps `uiType: "checkbox"` to a
  checkbox input). Before this, a lone tick box had to be faked as text. Works with a split too —
  one boolean per position.
- **Positions × options.** A printed row of holes that repeats at the front and the rear is now one
  pass: pick a split, pick `One of many`, declare the options, and the Boxes area becomes a
  positions × options grid. Save creates **one independent choice parameter per position**, each
  with its own option list and its own grouped mapping rule.
- **Front and rear may differ.** Each position is a separate parameter, so nothing forces the option
  lists to match — front with 3 holes and rear with 4 is legal. The panel shows one shared list
  (the common case) with a per-position *"different here"* override, so a 4-corner parameter doesn't
  put four editors on screen at 390px.
- **Fill order is across a position, then the next position** — the order a sheet prints a checkbox
  row (founder decision). It lives in `pendingBoxGrid.ts` (`findPendingCell`, row-major) rather than
  the component, because getting it wrong silently maps the rear row's boxes onto the front row's
  options. Unit-tested.
- **Option counts are declared up front for splits only.** Single mode still infers the option count
  from however many boxes you click — that flow is untouched.
- **A choice position needs 2 mapped boxes or it stays unmapped.**
  `buildGroupedRuleFromAssignments` returns `null` below two assignments, so a half-clicked row is
  reported in the status line and left for the sidebar's "Unmapped" filter rather than half-mapped.
- **Mapping rules are decided before the state update, not inside it.** A `setFormFieldMappings`
  updater can run later than the calling function (and twice in dev), so counting mapped boxes
  inside it left the status line lying. The rules are planned in a pure pass, then applied in one
  updater.
- **Grouped parameters never get a universal id** — the registry is numeric tuning values.

---

## Stages

### Stage 0 — Gold set + eval harness (first, before pipeline work) — ✅ built 2026-07-06

- ~10–20 real sheets per format with hand-verified expected values: Jordan's own
  Awesomatix (+ teammates') sheets, plus public sheets (PetitRC, manufacturer sites)
  for brand diversity (Xray, Mugen, Yokomo, …).
- Script (`npm run setup-extract:eval` or similar) scores field-level accuracy:
  **correct / wrong-but-flagged / wrong-and-confident** (the last is the failure that
  burns trust). Baseline the *current* pipeline before changing anything.

**Status:** `scripts/setup-extract-eval/` — Xray X4'22 gold set (8 PetitRC sheets, 5 with
**founder-verified gold** ×104 fields — Claude-transcribed, Jordan confirmed spot-on
2026-07-06) + blank AcroForm PDF. Xray chosen deliberately: not in the app yet, so it
exercises the full no-model → no-calibration → AI path. Current pipeline scores 0 on these
(no calibration exists — the exact gap this project closes).

| Extractor config (dual-pass) | Correct | Correct-or-flagged | Confident mistakes |
|---|---|---|---|
| gpt-4o, full image only | 70.5% | 83.0% | 88 |
| gpt-4o, + 2×2 high-res tiles | 83.4% | 92.1% | 41 |
| gpt-4o, tiles + schema checkbox hints | 84.6% | 91.9% | 42 |
| gpt-5 (low reasoning), tiles + hints | 89.4% | 96.0% ✅ | 21 |
| gpt-5 + gpt-4o cross-model passes | 85.2% | 97.5% ✅ | 13 |
| **+ marked-contract, cross-model (shipped reader)** | 86.9% | 96.9% ✅ | 16* |

Levers learned: (1) tiling — checkbox-group misreads dominate once OpenAI downscales the
sheet; (2) model — gpt-5 clears the bar where gpt-4o plateaus; (3) per-style schema label
hints describing checkbox geometry; (4) cross-model dual-pass — different models rarely
agree on the same wrong number, so disagreement lands in review; (5) the "marked" contract
— choice fields must declare a visible mark or return empty, code-enforced.

*Prompt tuning past this point hit a noisy ceiling (±3 confident mistakes run-to-run), so
we stopped chasing it — because the eval surfaced the decisive structural fact instead:

### The trust boundary (verified on the gold set)

**100% of the reader's *confident* mistakes are checkbox/choice fields. Zero are on
free-text or numeric values.** The model transcribes written numbers/text reliably; it is
only ever confidently wrong about *which box is marked* (or whether any is). So the Stage-1
trust policy is evidence-grounded, not a guess:

- **Free-text / numeric, high confidence → auto-import.** (No confident errors observed.)
- **Every choice / checkbox field → routed to review**, regardless of confidence.

On this gold set that leaves **zero silently-shipped confident errors**. The cost is review
load (~40 checkbox confirms per sheet); **Stage 2 region mark-detection is precisely what
makes choice fields auto-importable and removes that load** — a filled-box detector on a
known region is near-perfect where the full-page LLM is not. This is the strongest argument
for Stage 2 and it now rests on data.

Gold is founder-verified (2026-07-06), so these numbers are trustworthy ground truth.

### Stage 1 — AI vision extraction for uncalibrated uploads

- No calibration match → full-page vision-LLM extraction targeted at the car's sheet
  model schema, returning per-field value + confidence + approximate location.
- Word-level OCR runs alongside; the LLM maps values onto OCR word boxes (geometry
  from OCR, understanding from the LLM) — this yields trustworthy evidence crops and
  seeds Stage 2 regions.
- Confidence-gated review with evidence crops; confirmed values create the setup.
- Calibrated AcroForm path unchanged and free throughout.

### Stage 1.4 — Car identification (the front door) — ✅ built + verified 2026-07-06

The end goal is personal-first (founder interview 2026-07-06): a driver uploads a touring
sheet → the app recognizes the car, or lets them create it instantly (private, no admin
wait) → reads it → it becomes a **full setup on that car** (runs/compare/Engineer/aggregations).

- `identifySheetCar()` reads the printed brand/model from a cropped header strip (cheap
  model — branding is printed black, an easy read; no dual-model needed).
- `matchSheetModelForIdentifiedCar()` (pure, unit-verified 5/5) fuzzy-matches the identified
  car against the user's accessible sheet models — year-form + apostrophe normalization
  (`X4'22` ⇄ `Xray X4 2022`) and a discriminative model-token rule (`X4` must not match
  `T4`). Confident match (≥0.6) → link + use that car's schema for extraction; no match →
  offer one-tap new-car creation seeded with the identified name → Stage 1.5 drafts its schema.
- **Verification (2026-07-06):** matcher 5/5 offline; `identifySheetCar` live on all 8 Xray
  sheets (incl. the JPEG) → every one `Xray X4'22` at confidence 1.0, ~2s each on gpt-4o.
  Matches the in-app car at 1.00 when present; suggests "Xray X4'22" for creation when absent.

### Stage 1.5 — AI-drafted schemas for unknown cars — 🟡 built + verified 2026-07-06

- Upload for a car with no sheet model → `draftSetupSheetModelSchema()` reads the sheet's
  printed layout and proposes the field set (key, label, section, choice-vs-text + options,
  universal id). User gets a provisional private car immediately; admin later
  reviews/promotes the schema to shared/global (governance).
- **Universal-parameter mapping is mandatory, not optional.** Every drafted field that is a
  cross-car concept MUST carry its `universalParameterId`, or that car silently drops out of
  community aggregations. The drafter is prompted with the canonical registry and told to
  reuse those ids; `suggestUniversalParameterId()` runs as the backstop/validator.
- **Verification (2026-07-06):** drafted from the X4'22 sheet as a "new car" → 77 fields in
  ~25s (gpt-4o), sensible 33-choice/44-text split, and **14/14 universal parameters mapped
  correctly, zero missed, zero spurious** — the new car would aggregate perfectly. (77 < the
  ~100 of the exhaustive hand schema: the drafter captures the substantive fields; granular
  checkbox sub-fields are what an admin refine pass adds — and schemas are admin-reviewed
  anyway.)
- **RETIRED 2026-08-06 — auto-creating a chassis type from an upload is gone.** It was wired
  behind `SETUP_AI_EXTRACT=1` on 2026-07-06 (quick-create's unrecognized-image branch ran
  `ensureSheetModelForUpload` → identify → match the global catalog → or mint a
  `SetupSheetModel` with `isAuthorized:false` plus a `Car` for the uploader) but was never
  driven in a browser, and the caller had already been unwired before the module itself was
  deleted. **Sheets are now authored by hand**: a driver whose chassis has no curated model
  fills the generic 43-parameter sheet, or creates their own chassis type (live but flagged
  until an admin authorizes — see `docs/ASSET_ACCESS_NORTH_STAR.md`).
  `draftSetupSheetModelSchema` and `draftedSchemaToModelSchema` survive as offline eval tools
  under `scripts/setup-extract-eval/`; nothing in the app calls them.

### Stage 2 — Auto-calibration cache (the "learn where parameters are" step)

- Each confirmed Stage 1 review persists field regions + style fingerprint
  (existing pHash + anchor alignment). A few confirmed uploads of a style converge
  the regions, then the style is "calibrated".
- Repeat uploads: fingerprint match → align → crop regions → read values with
  classical OCR (free, good on clean digital text) or a cheap vision model on the
  tiny crops (~100× cheaper than full-page; what the calibrated image path already
  does today). Full-page LLM only for brand-new styles and low-confidence retries.
- **Even a matched calibration still runs the confidence check** (founder call
  2026-07-06) — a blessed calibration never gets blind trust. Choice/checkbox fields
  in particular stay review-routed until region mark-detection proves them (see
  Trust boundary). Fingerprint versioning means a revised sheet simply fails to match
  the stale calibration and falls back to AI, rather than mis-reading against it.
- Admin promotion makes one user's confirmed style benefit every owner of that car.

### Stage 2A — Blank-sheet anchor (primary Stage 2 path — founder interview 2026-07-07)

Verdict from the second live upload (Eldridge X4'26, 43 flagged fields): the flags split
into three failure classes, all with one root cause — nothing ties a schema field to the
physical box it lives in:

1. **Drafted-schema mis-structure** — e.g. the sheet's `FRONT UPPER` choice group
   (CFF Arm-S / Links Short / Links Long) drafted as four overlapping phantom fields;
   an "Options 1–4" section that doesn't exist on paper.
2. **Missed marks** — clearly-X'd checkboxes (Track Surface, PSS, Caster) returned
   "not set" by the full-page reader.
3. **Value misattribution** — a nearby number grabbed for the wrong field
   ("Upper Clamp = 5" from an adjacent screw-count annotation).

**Decision (founder interview 2026-07-07): the manufacturer's *blank* sheet, ingested
once per model by the admin, is the primary teaching mechanism.**

- Blank sheet → AI drafts the schema structure (cleaner than drafting from a filled
  sheet — no handwriting to confuse it) **plus per-field regions**, emitted as an
  auto-generated `ImageCalibration` whose reference image is the blank.
- Admin reviews visually — click a field ↔ its box highlights on the blank — and fixes
  regions with the existing editor tooling. Admin-per-model was the chosen ownership
  (bounded: touring is ~10–15 models; schemas are admin-gated anyway per governance).
- Filled uploads: car identification already links the model → use the model's
  calibration → **existing** image pipeline (align → crop regions → darkness
  mark-detection on choice boxes + batched crop-OCR on text) → the Stage-1 confidence
  policy stays on top. The full-page AI reader demotes to fallback/cross-check.
- **Evidence crops in review come free from regions** — the review-panel crop
  requirement is unblocked by the same artifact.
- Alternatives considered and deprioritized (2026-07-07): click-to-assign regions in the
  review panel (complements later, conflicts with effortless-logging for end users);
  schema hint text only (doesn't fix mark detection); passive correction-convergence
  (can't restructure a bad schema). Correction capture remains planned as signal.
- **Pilot: Xray X4'26** — fix its drafted schema, build its blank-sheet calibration,
  re-run the Eldridge doc as the acceptance test (target: flags collapse to genuinely
  empty/ambiguous fields only).

**Pilot results (2026-07-07, offline read of the Eldridge sheet through blank-derived
regions):** every miss class fixed — surface/layout/traction/PSS/caster/drive-shafts/hubs
all detected correctly; `fr_upper_arm` reads "Links short" as one real choice group;
misattributed values land in their own fields; handwritten "Steal 1.2" captured; unmarked
groups correctly return nothing. **Measured mark-detection physics:** a marked box (red X +
printed border) reads ~0.33–0.41 mean darkness, unmarked ~0.24–0.30; real marks lead the
runner-up by ≥ 0.05, ambiguous/unmarked by ≤ 0.03. The legacy pipeline gate (winner ≥ 0.45,
margin ≥ 0.08) rejects every real mark — group fields now carry optional per-field
`minWinnerDarkness`/`minMargin` (blank-sheet drafter emits 0.30/0.05; legacy calibrations
keep the old defaults). Geometry source: prefer the manufacturer's **editable AcroForm
blank** when one exists (Xray publishes them) — widget rectangles give exact regions and
exact field structure with zero AI; the LLM only labels semantics (batched, coordinate-
guided, one repair pass for dropped fields → 0 warnings on X4'26's 201 fields). Stacked
crop-OCR mismaps keys at ~100+ crops per image — region OCR must stay chunked small before
it can replace the full-page reader for text (Stage 2 cost work, not needed now).

**Course-correction (founder interview 2026-07-07, round 2 — supersedes the "AI drafts the
schema" framing above where they conflict).** After a second live review still showed rough
AI labels, phantom relevance, and 130 flags, the founder reframed the target: **one manual,
admin-owned box calibration per sheet model — get it perfect once, then forget it — not
per-upload AI review.** The AcroForm work is kept because it makes that manual pass cheap, not
because AI is the authority. Three rulings:

1. **Seeded box editor, not blank-draw and not AI-authoritative.** The editable-PDF geometry
   is pilot-perfect and free, so the admin's calibration editor opens with all ~201 boxes
   *pre-placed*; the admin confirms / renames the rough labels / fixes the odd box / assigns
   universal params — reviewing, never drawing. Hand-draw stays only as the fallback for
   image-only sheets with no editable PDF. Build on the existing `ImageCalibrationEditorClient`
   (already loads `initialFields` regions + draws/edits them); the new work is a **model-level**
   entry point seeded from the blank + label/universal-param editing. **Full per-upload AI
   extraction is demoted to the last-resort path for an uncalibrated brand-new sheet.**
2. **Keep all fields; auto-import silently; curation is not a chore.** No admin field-pruning
   step — every field imports if detected; noise fields (weight positions, diagram artifacts)
   simply never surface in review. Relevance is handled by *not showing*, not by *deleting*.
3. **Review only misses/conflicts.** A confident region mark on a calibrated box **auto-imports
   with no review** (`mergeReaderAndRegions`, `runAiExtractionForImageDoc.ts` — shipped
   2026-07-07); the review screen shows only choices where detection found no confident mark,
   plus text the dual-model reader flagged (low-confidence / disagreement). This retires the
   pre-region "every choice field is review-routed" policy, whose rationale (the full-page
   reader confidently misreads choices) no longer applies now that choices come from region
   detection. The "even a matched calibration runs the confidence check" rule (Stage 2 above)
   is satisfied by the darkness gate itself — ambiguous marks fall through to review.

### The ultimate goal, sharpened (founder interview 2026-07-07, round 3)

Triggered by the "Could not read PDF form fields — PDF only" break (see bug below) and a
founder sense that the system wasn't aiming at the real target. Five rulings — where they
conflict with earlier framing (confidence-gated review as the product, ≥95% correct-or-flagged
as the bar, user-visible calibrations), **these govern**:

1. **End state for a calibrated model = silent.** Upload a filled sheet → the setup just
   appears on the car. No review panel in the default path. A wrong value is fixed on the
   setup like any manual edit, and every such correction is **logged as a calibration-quality
   signal** the admin can review. The review panel survives at most as an opt-in door; it is
   not a step.
2. **Calibration is admin-only, invisible machinery.** End users never see the word. Jordan
   calibrates each touring model once (~10–15 models); drivers only ever experience
   upload → setup. (Tightens 2026-07-06 governance: user-created private/team calibrations
   drop out of the near-term picture.)
3. **The standard is 100%, carried by the calibration — not "AI misses are okay, flag them."**
   Confidence-gated review was the right posture while the AI reader was the authority; it is
   not the product. A completed calibration must read essentially perfectly, **verified before
   go-live by test reads in the workbench**: drop known filled sheets in, see every read
   side-by-side against the sheet, green-light the model. Until it passes, the model isn't
   calibrated.
4. **Digitally-filled sheets are the flagship input — but that doesn't mean PDF.** Filled
   AcroForm PDFs read deterministically (works today, keep). The common hard case is a sheet
   that exists only as a **PNG/JPEG** — both the blank (no free geometry) and the filled copies
   (typed text rendered into pixels). Typed text in crisp images is near-perfect via calibrated
   crops; handwritten photos remain the secondary lane where 100% is not promised.
5. **Next build = one admin workbench, per model.** `/setup-sheet-models/[id]` becomes the
   whole calibrate-a-model job: blank reference, seeded boxes, **label + universal-param
   editing in the same place as geometry** (today labels live in `schemaJson`, boxes in the
   calibration, edited in different tools), test reads, and buttons replacing the npm-script
   steps (`setup-extract:register-blank`, `setup-extract:blank-apply`). For PNG-only blanks,
   AI drafts boxes + labels from the blank image and the admin adjusts — same ritual as
   AcroForm, less precise seeding. The gen-1 AcroForm field-mapping lane is **kept**, co-located
   in the workbench as a sibling workflow (PDF mapping · image boxes), not retired.

**Round 4 (same interview, closing the mechanics):**

- **The goal is the SYSTEM, not any one model.** "X4'26 verified to 100%" is a consequence of
  the system working, not the target. Deliverable: ingest any blank → calibrate → prove →
  forget, repeatable per model in minutes-to-an-hour of admin time.
- **Verified = whole-sheet green-light.** Admin runs 1–3 known filled sheets through the real
  pipeline in the workbench, eyeballs the side-by-side, flips one verified switch on the
  model's calibration. No per-field verification ledger as a gate. After verification,
  geometry/option edits mark just the affected fields "needs re-check" (informational; the
  model stays live); label-only edits don't invalidate.
- **Attribution is the failure mode, transcription isn't.** Founder ruling: the full-page AI
  reader is near-100% at reading a number or telling a checked box — and bad at knowing which
  field a value *corresponds to* ("front height"). Calibration boxes are exactly the
  attribution fix, which is why per-upload full-page extraction **can never be the user
  product** for structured values.
- **Uncalibrated-model upload = sheet attaches now, values later.** The upload immediately
  becomes a setup with the sheet image attached (still the record — viewable on runs/compare).
  Car-ID still runs (create/link model + car), and the upload pings the admin to calibrate.
  When the model's calibration is verified, parked docs **re-extract automatically** and
  structured values appear. No draft values, no user-facing review.
- **Stage-1 AI lane demoted to internal machinery.** The per-upload extraction + review panel
  retire from the user path. The reader survives where the calibrated pipeline and the
  workbench need it: text transcription on calibrated crops, box/label drafting from blanks,
  and prefilling admin test-read comparisons.

### Public-release strategy (founder interview 2026-07-20, five rounds)

Triggered by "can anyone upload any setup for any car when the app goes public?" Where
these rulings conflict with earlier framing, **they govern**.

**Verdict on the ultimate goal:** not fully automatic, but honestly achievable in this
form — any model whose manufacturer publishes a **fillable (AcroForm) blank PDF** gets
calibrated fast by the founder with AI doing the heavy lifting; the founder's read is
that **most top brands publish one**. Everything else degrades honestly (below).

1. **Trust is absolute.** "A semi-working setup sheet reduces trust immediately" —
   never show half-read values. Parked/pending until verified stands. This also
   **rejects a user-facing calibration wizard**: users never calibrate, no
   trusted-user tier for now (revisit only if new-model volume swamps the founder).
2. **The architecture is streamlined-founder-calibration, not full-auto.** Corrected
   mid-interview: the MTC3 loop's free ground truth existed only *because* a founder
   calibration already defined field meaning. The blank gives geometry for free; the
   **meaning layer** (names, groups, one-of-many vs many-of-many, conventions,
   universal params) is AI-*drafted* but founder-*approved* — he reviews, never
   authors. One human calibration then unlocks **both lanes**: the MTC3-style
   fill→render→read-back→diff loop converts it to image detection automatically and
   self-verifies against the PDF lane.
3. **The measured time sink is volume, not difficulty** (MTC3/X4'26 experience):
   authoring choice groups/checkboxes and verifying names across ~200 fields — not
   cryptic field names, not conventions, not misread-chasing. The workbench therefore
   optimizes **bulk review throughput**: proof-overlay (AI's understanding drawn on
   the sheet — groups color-coded, names at each box; verify by glancing at the sheet,
   not a 200-row list), group-at-a-time confirm, evidence crop beside every field.
4. **New-car UX = pending → appears.** Unknown model: sheet attaches instantly as an
   image, viewable on runs + compare — and **nothing more** during pending (no typed
   essentials, no Engineer-reads-the-image). Values appear retroactively when the
   model is green-lit (parked docs re-extract, per round 4).
5. **No-blank models (image-only brands, discontinued cars): picture-only forever is
   fine.** No image-drafting fallback lane, no hand-calibration promise. Softens
   round 4's "pings the admin to calibrate" — models without a fillable blank simply
   stay pictures.
6. **Digital-only at launch.** Handwritten paper photos stay out of scope until they
   clear the Stage 3 eval bar (reaffirms Stage 3 gating).
7. **Pre-launch: pre-ingest sweep.** Collect fillable blanks for the popular
   touring/off-road models and calibrate them ahead of time, so most public uploads
   hit an already-verified model and pending is rare. Key metric: **founder-minutes
   per model** — at ~20 min, 30–50 models is a couple of weekends.
8. **Display direction: mirror the sheet's own layout** (values rendered in the
   sheet's positions/groups — coordinates are free) so grouping never has to be
   re-invented — **prototype via artifact before committing**; scope (all cars vs
   auto-learned only) undecided.
9. **Sequencing: workbench first**, bulk aggregation lane after.

**Code-audit inventory (2026-07-20) — the workbench is assembly, not invention.**
Already built and refined: the PDF calibration editor (click-widget-to-map, quick-add
with inferred key/type/section, group creation with one-of-many/many-of-many
inference, widget-ownership guards); the blank-sheet AI drafter (offline scripts only
since 2026-07-22 — the in-app `draft-from-pdf` wizard is deleted, see the refinement
above); the image editor with seeded boxes + detect-boxes click-to-assign; in-app green-light
with `fieldsNeedingRecheck`; fingerprint auto-pick with empty-shell + cross-model
guards; silent region-detection import; ~14 hard-won image-pipeline refinements
(redness marks, center measurement, Otsu, content-box alignment, consensus OCR…) —
**no engine rebuilds, ever**. Genuinely missing, all glue: **(a)** one unified home
for the flow (today it spans the wizard, schema editor, two calibration editors, and
npm scripts), **(b)** test-read side-by-side UI behind the green-light, **(c)** the
MTC3 self-test as an in-app button (productizing it should call the production
pipeline directly, shrinking the `mtc3-common.ts` hand-mirror regression trap),
**(d)** the proof-overlay review layer, plus the routing bug below. Backlog, not
build-now: a "code-filling" pass (founder types matching codes into blank-PDF boxes to
declare groups spatially — deterministic via AcroForm read-back; build only if group
errors still eat time after 2–3 cars through the workbench).

**Known bug (found 2026-07-07, unfixed):** every calibration link routes to
`/setup-calibrations/[id]`, which unconditionally renders the PDF form editor
(`SetupCalibrationEditorClient`); an image calibration (e.g. "Xray X4'26 — blank sheet (auto)",
sourceType `blank_sheet_image_v1`, example doc = JPG) hits `/api/setup-documents/[id]/pdf-form-fields`,
gets 400 "PDF only", and shows "Could not read PDF form fields." The working editor is
`/setup-documents/<blank-doc-id>/calibrate-image`. Fix lands with (or before) the workbench:
route by calibration source type.

---

## Governance — who benefits from a learned calibration/schema (founder interview 2026-07-06)

Today, calibrations are globally visible to every user (`calibrationsVisibleToUserWhere`
returns `{}`). The target model is tiered and gated:

| Artifact | Private (uploader) | Team | Global / community |
|---|---|---|---|
| **Calibration** (where values sit on a known sheet) | immediately | **immediately** to teammates on the same car | **admin-curated** promotion only |
| **Schema** (a new car's whole field set) | immediately | **not** until approved | **admin-approved** before anyone builds on it |

- **Schemas are stricter than calibrations.** A wrong calibration mis-reads one sheet; a
  wrong schema mis-shapes every upload + every aggregation for that car. So a drafted
  schema never reaches teammates or global until admin sign-off.
- **Promotion is manual curation, not automatic.** Admin browses confirmed calibrations
  and promotes the good ones — no auto-candidate machinery. (Revisit if volume makes the
  admin a bottleneck; a data-driven "high-agreement" queue is the fallback.)
- **Defense against bad/stale global data:** version each calibration by sheet fingerprint
  (a revised sheet won't match a stale one) **and** always run the confidence check even on
  a matched global calibration; a "this extraction looks wrong" report flags it for
  re-review.
- **Schema-change note (not yet built):** the tiered model needs `SetupSheetCalibration`
  columns for `sharingScope` (private|team|global), `origin` (manual|ai_auto),
  `sheetFingerprint`, and a promotion/approval state; access queries move off the current
  "everything global" default. Committed migration + `migrate deploy` only (never db push).

---

## Bulk aggregation lane (e.g. "point at PetitRC's X4 page, ingest hundreds")

Bulk-for-aggregation is an *easier* quality problem than personal upload: a few wrong
values wash out of a distribution, and the fields that matter (numeric universal params)
are exactly where the reader is strongest. Measured on the verified gold set, scoring
**only universal parameters** (14/sheet — ride height, droop, camber, toe, springs,
shock oil, ARB; `SETUP_EXTRACT_SCOPE=universal`, `SETUP_EXTRACT_PASSES=1` for cheap):

| Config | Correct | Wrong-confident | Verdict for unattended bulk |
|---|---|---|---|
| **Dual gpt-5 + gpt-4o (default)** | **97.1%** | **0** (2 wrong were flagged) | ✅ gate on conf ≥ 0.8 → **100% of ingested values correct** (68/68; 3% coverage loss) |
| Single-pass gpt-5 | 94.3% | 4 — all one pathological sheet ("kit" written in oil boxes → cell-merge misreads) | ⚠️ acceptable *only* with numeric-only + outlier rejection (the misreads were non-numeric or absurd-valued) |
| Single-pass gpt-4o | 90.0% | 7, **zero flags** — self-confidence is uniformly 1.00, so the gate catches nothing | ❌ unsafe alone; plausible-looking wrong ride heights would enter the pool |

Policy for the bulk lane:
- Ingest **numeric universal params at confidence ≥ 0.8 only**; skip flagged (statistically
  cheap) rather than review them.
- **Outlier rejection** on each parameter's distribution before materialising aggregations.
- **Sampled QA** (5–10% of sheets scored gold-style) to catch *systematic* bias — random
  error washes out, a consistent per-field misread shifts the distribution and is the only
  real threat.
- Provenance-tag scraped docs (`community-scraped, AI-read`) so they're auditable/pullable.
- Same-template batches are the killer app for **Stage 2**: learn the template once, read
  the remaining hundreds by region for ~free — that, not model-downgrading, is the real
  cost answer. Until then, bulk runs the dual-model default; cost of "correct" beats the
  savings of "cheap but silently wrong".

Caveat: numbers are from 5 sheets of one template. Before a real hundreds-scale run, widen
the gold set a little (more X4 sheets + a second template) to confirm no per-field
systematic bias at scale.

---

## Per-car aggregation — governance & sequencing (founder interview 2026-07-06)

Per-car aggregation (every setup option pooled for a specific car, feeding Engineer context)
is **decoupled from upload and admin-gated — not automatic**:

- A new car can be uploaded and used for **personal setups immediately**; it does **not**
  aggregate. Aggregation is not a concern until the car earns global approval.
- Aggregation for a car turns on only when the admin (Jordan) **promotes its schema to
  global AND selects which fields are aggregatable**. Field selection is a deliberate admin
  decision at approval time — *not* the AI drafter, *not* an automatic `showInAnalysis` rule.
  (So the schema-driven auto-selection floated earlier is **rejected** in favour of admin
  curation.)
- The existing `tuningComparisonKeys` allowlist is, in effect, the admin-approved aggregatable
  set for today's global cars (Awesomatix / A800RR). New cars extend that set at promotion —
  future clean mechanism is a per-car aggregatable-field flag rather than one central list,
  but there's no rush and no auto-selection.
- **Sources stay separate + labeled:** published/pro (PetitRC) vs app users — cited distinctly
  by the Engineer, never silently merged.
- The rich per-car stats already exist (median / mean / IQR / std-dev, categorical frequency,
  above/below-typical, hedged-direction-at-position — `setupSpreadForEngineer` + the
  `ENGINEER_NORTH_STAR` community-position policy). Newly-approved cars inherit all of it.
- **How the Engineer best uses per-car aggregation is a deliberate FUTURE design task** — the
  founder wants to think on it, not rush it. The north-star behaviour already framed: when a
  helpful move is *hedged* and the driver is already at an extreme for this car, steer back
  toward centre rather than further out. Broader use (outlier flagging, norm citing,
  starting-setup seeding, condition-sliced norms) is TBD.

---

## Universal parameters — keeping cross-car aggregations aligned

Aggregations pool values across cars by a **canonical parameter id**, not the sheet's own
key: a sheet may label a row "Downstop" but it aggregates as `droop_front`
(`src/lib/setupSheetModels/universalParameters.ts`, 16 canonical touring params with
aliases). Snapshots still store each sheet's own `key`; the canonical id is the join.

**The rule for every AI path:** an extracted/drafted field that is a cross-car concept must
resolve to its `universalParameterId`, or that car quietly disappears from community
aggregations for that parameter.

- Extraction schemas carry `universalParameterId` through the bridge
  (`buildExtractionSchemaFromModel` → `ExtractionFieldDef.universalParameterId`): it trusts
  the model field's declared id, else infers via `suggestUniversalParameterId(key, label)`.
- `suggestUniversalParameterId` (`matchUniversalParameter.ts`) = registry/alias exact match,
  then conservative concept + axle heuristics (toe / ride height / droop / camber / roll
  center / ARB / shock oil / spring × front|rear). It returns **nothing** when the axle is
  ambiguous (e.g. bare "toe gain") rather than risk a wrong pool. Verified 13/13 on the
  Xray X4'22 fields incl. the must-not-map cases (`pinion`, `chassis`, `toe_gain`).
- Stage 1.5 drafting must prompt with the canonical registry and use these ids for universal
  concepts; the matcher is the validator on the drafted output.

### Stage 3 — Phone photos of paper sheets

- Gated entirely on the Stage 0 eval bar. Adds deskew/lighting normalization and
  handwriting (vision-LLM crops, not classical OCR). If it can't clear
  correct-or-flagged ≥95%, it doesn't ship.

---

## Where setups live — "My setups" is car-first (founder interview 2026-07-22)

Uploading is only half the job; the other half is finding a setup again. Garage › **My setups**
(`/setup`) is a **car index**, not a document list — the old "Downloaded setups" / "Setups from
runs" split organised by provenance, which is never how a driver looks for a setup.

| Surface | Contents |
|---|---|
| `/setup` | One row per car (saved + uploaded counts, last run). Upload button stays here. Sheets with no car, and the admin link, sit at the bottom. |
| `/setup/[carId]` | Three grouped sections: **Saved setups** (`SetupSnapshot.isLibrary`, via `CarSetupsCard`) · **Uploaded sheets** (`SetupDocument`) · **From runs**. |
| `/setup/[carId]/[setupId]` | Read-only sheet (`SetupSheetView readOnly`). Edit only for saved setups — run history is immutable. PDF + Open run alongside. |
| `/setup/admin` | Calibrations list + bulk import / comparison / aggregation debug. Admin-only. |

**From runs shows only runs where the setup actually changed** — filtered on the
`setupDeltaJson` audit written at log time (`/api/runs`), plus runs with no baseline at all
(pre-library history). A run that reused the previous setup unchanged adds no row.

---

## Supersedes the green light on the upload door — two mechanisms, not one (2026-08-11)

**Read this before touching anything that decides whether a driver may upload a sheet.** The
question kept getting re-litigated because the doc above only ever describes one of the two things
below, and the code had merged them into a single switch.

They are separate:

| | What it needs | What it buys |
|---|---|---|
| **Using a sheet** | An editable PDF whose boxes the app can find | The driver fills their own sheet, uploads a filled one, logs runs against it, and sees what changed between two runs |
| **Understanding a sheet** | A human to name the boxes (the green light) | The Engineer can reason about the setup and suggest changes |

**A chassis needs only the first to be fully usable.** Nobody has to name a box. The manufacturer
already printed the caption next to it, so the driver reads their own sheet off the paper. This is
what "your setup sheet becomes your car" (2026-08-11) actually delivers, and it is why the door is
open to any driver holding an editable PDF.

**The green light keeps its real job** — telling the Engineer whether it can read this car. On a
chassis with unnamed boxes the Engineer says so plainly rather than reasoning around a gap.

### What changed in the code

`carSupportsSheetUpload` gated the upload door on a green light. That meant the Xray X4'26 — a
chassis built from its own blank PDF, every box mapped from the file's own form layer — was offered
a greyed-out door saying "we can't read a sheet for this yet", when in fact it reads that sheet
exactly. The rule now lives in `src/lib/setupCalibrations/uploadDoorRule.ts`: a calibration opens the
door if it can read an editable PDF (non-empty `formFieldMappings`) **or** it is green-lit.

**Image calibrations still need the green light.** They read values out of pixels by region and OCR,
with no form layer to anchor to and no equivalent of "the file told us its own box names".

### Why round 3's "partially-read is worse than none" no longer gates this

That standard (2026-07-22) was set when a read was **invisible** — a list of extracted values with
no way to see what had been missed. What was read now lands on a picture of the driver's own sheet,
where a box that got nothing is a visibly empty box. A partial read became something the driver can
see and fix, so it stops being a silent wrong answer. The standard still governs what the *Engineer*
is allowed to treat as known.

### The wrong-file guard is separate again, and stricter

Uploading the wrong sheet is not caught by a coverage percentage. `fingerprintPick.ts` matches the
PDF's **set of AcroForm field names** exactly against known calibrations, scopes the match to the
chosen car's chassis, and blocks with a 409 plus "Change car / Use anyway" before anything is
stored. Sheets from different makers that share generic internal names (`Text1..N`) hit the
cross-model disambiguation path instead of being guessed at.

### No image sheets. At all. (2026-08-11 — decided more than once)

**An editable PDF or nothing.** Not a photo, not a scan, and not a flat PDF. A refused upload is
refused *before anything is stored*, and the message names the file to go and find instead of
merely saying no.

This has now been decided at least twice and lost in between, which is why it is written here
rather than only in a commit message. **Do not re-open an image path without changing this
section first.**

What enforces it:

| Gate | Where |
|---|---|
| Only `application/pdf` is accepted | `SETUP_DOCUMENT_ALLOWED_MIME` — `src/lib/setupDocuments/types.ts` |
| A PDF with no form layer is refused, with the "look for the editable one" message | `POST /api/setup-documents/quick-create` |
| Same refusal on the blank/chassis door | `refusalForBlankExtraction` — `blankUploadDiagnosis.ts` |
| The file picker never offers the photo library | `QUICK_CREATE_SETUP_ACCEPT_MIME` |
| Pinned to the real Xray fillable/flat pair | `e2e/setup-sheet-upload-door.spec.ts` |

**The flat-PDF raster bridge is gone.** `quick-create` used to render page 1 of a form-less PDF to
a PNG and send it down the image pipeline. That was the last way an image sheet got in — and the
driver never chose one, the app made it. What followed was almost always *"your sheet is saved,
values will import automatically once it's supported"*, which was not true: reading it needs a
hand-drawn image calibration for that exact chassis, and none was coming. Promising an import that
cannot happen is worse than refusing.

`renderPdfFirstPageToPng` still exists for `deriveImageMap` — admin tooling for authoring an image
calibration by hand. Different job, unaffected.

**Consequence for the upload door:** a green-lit image calibration must NOT open it. It would open
onto a file type the next screen refuses. The rule in `uploadDoorRule.ts` is the single test "can
this chassis read an editable PDF".

The image branch in `quick-create` is now unreachable and is signposted in place rather than
deleted; unpicking `imageBlockReason` / `imageNeedsCar` reaches into the review screen's response
shape and is a separate change.

### Correcting the 2026-08-06 entry above

The Stage 1.5 note says auto-creating a chassis from an upload is gone and that a driver "fills the
generic 43-parameter sheet, or creates their own chassis type". That was true on 6 August. On 11
August the blank-sheet door shipped: a driver uploads their chassis's editable PDF and gets a
working chassis with every box on it, derived from the form layer, no hand authoring. The retired
thing was the **AI-identification** front door, not creating a chassis from a file.

---

## The sheet is the whole sheet — import, edit and export every printed box (2026-08-14)

Founder call. Now that the sheet PICTURE is the surface a driver reads and edits a setup on, a
printed box with no key is a box they can see and cannot touch — and one that never survives an
upload or reaches an export. Three decisions, all shipped together.

### 1. The calibration menu no longer asks for a group

The Section control is gone from the naming panel, the sidebar's "New parameter…" and the quick-add
panel. A parameter's location is now its box on the paper, so typing a group bought nothing.

- New parameters land in `"Other"` (`DEFAULT_SECTION_TITLE`, `newParameterDef.ts`).
  `groupTitleChoices`, `sectionChoicesForSheet`, `suggestGroupTitleForLabel` and
  `existingGroupTitles` are **deleted** — do not bring them back for a future form.
- `sectionId` stays on the field def. It still feeds `groupFieldsBySection`, which buckets a
  flat-field model's form and drives `setupFillOrder`'s per-section progress.
- **What this costs, stated once.** A model with `structuredSections` is unaffected — its display is
  regrouped into the universal seven by `groupForFieldKey`, from the key and label, never
  `sectionId`. A **flat-field** model that falls back to the form loses its group blocks: everything
  new arrives in one "Other" bucket. That is a surface the sheet replaces, and the trade was taken
  deliberately.
- The AcroForm derivation still writes its own geometric sections (`sectionsByGeometry`) — that is
  not the menu, it is free, and the union below depends on it.

### 2. A calibrated chassis gets every box, not just the named ones

`unionDerivedWithCalibration.ts` runs the existing total derivation over a curated chassis's blank
while **excluding** every box the calibration already claims and **reserving** every existing schema
key, then appends a parameter + box + mapping for the remainder. Additive only: nothing is renamed,
re-pointed or removed, and the permanent keys behind two seasons of runs are untouched.

- Unnamed boxes arrive `showInLogRun: false`, `showInAnalysis: false`, labelled by position ("Box 47
  · page 2, upper right"). Naming one later is a `displayLabel` change, never a key change.
- Run it with `npm run union-boxes -- --slug <slug> [--apply] [--prod]`, or `applyUnionToChassis`.
  Safe to re-run: a box that already has a key is claimed.
- **The derived mappings live on `SetupSheetBlank.derivedMappingsJson`, NOT in the calibration.**
  Values read through the calibration's `formFieldMappings` are finished by
  `finalizeAwesomatixStringImport`, whose `rewriteImportedCalculatedDisplayKey` hard-codes `text91`
  and `text93` onto Awesomatix spring-rate keys — and derived keys live in exactly that namespace on
  a generically-named sheet. They are read with `readDerivedSheetValues` instead. Second reason:
  `normalizeCalibrationData` is a whitelist rebuilt on every calibration save, which is what
  `SetupSheetBlank` exists to survive.
- The A800RR's four **computed** boxes (`A800RR_EXTRA_SIMPLE_KEYS` — spring rates, final drive,
  notes) are claimed by the union and deliberately kept OUT of `derivedMappingsJson`: putting them
  there would make the import read a stale printed number in front of the value the app works out.
  They are added at export time only.

### 3. One export engine — fill the manufacturer's blank

`src/lib/setup/pdfRender.ts` is **deleted**. It painted white rectangles over every widget, drew the
values itself, flattened the file, and was wired to the Awesomatix readers — a dead picture that
really knew one car. Export now goes through `fillPdfForm`, which writes into the blank's own form
fields and keeps its fonts and tick marks.

- **The substrate is the CHASSIS's blank** (`SetupSheetBlank.setupDocument`), not the driver's
  upload. So every driver on a car exports the same paper, and a driver who never uploaded anything
  gets a PDF at all. The per-user document walk survives only as the fallback for a car with no
  chassis model — those still 404, honestly.
- Values reach the paper through `storedValuesToSurface`, the same bridge the on-screen sheet uses,
  so what a driver sees in a box and what lands in the PDF cannot drift apart.
  `flattenFillMappings` resolves a calibration's four grouped rule shapes ("which box is ticked")
  into the one-box-one-value pairs `fillPdfForm` writes.
- **The paper is emptied before it is filled — but how much depends on whose paper it is.**
  - *A chassis blank is cleared entirely.* It is whichever PDF created the chassis, very often
    somebody's finished sheet — the A800RR's is the calibration's own example document. Caught in
    the browser on 2026-08-14: the first export printed "Jordan Caruso / TFTR / 13.5T" and a full
    set of geometry onto a setup holding none of it, under the current driver's own values.
    `sheetPageImages` already cleared the PICTURE for this reason; export now clears the paper.
  - *A driver's own upload is cleared only where the app maps it* (`blankPdfFormValues`'
    `onlyFieldNames`). There is no one else's data in it to hide, so clearing everything would
    silently blank every box the calibration doesn't name — ~109 of them on an A800RR. The engine
    this replaced whited out exactly the mapped widgets and no others; this keeps that.
- `SETUP_PDF_RENDER_PIPELINE_VERSION` is 3; every cached PDF from the old engine re-renders.
- **Do not flatten on the way to a picture.** Tried and rejected the same day: pdfjs draws the live
  form widgets fine (checked on the Xray '26 and Mugen MTC3 blanks, manufacturer marks and all), and
  flattening makes the picture *worse* — an auto-sized box gets its text burnt in at the wrong size.
  pdf-lib's `flatten()` also throws on all three repo blanks, because an unticked box stores no
  `/Off` appearance.

### A mapped key with no schema field is a box that cannot exist

The calibration's left-hand side is a schema key, and nothing ever checked that the schema had one.
Eight of the A800RR's didn't — `date`, `name`, `race`, `class`, `track`, `country`, `air_temp`,
`track_temp`, exactly the printed header strip. `boxesFromCalibrationMappings` skips a mapped key the
schema doesn't declare (it has no label, no type, nothing to match an option against), so those eight
drew blank on screen and exported blank. Reported from prod 2026-08-14.

The union pass cannot reach them: their widgets *are* claimed — by the calibration — so it correctly
leaves them alone. The gap is on the schema side. `fieldsForCalibrationOnlyKeys` mints the missing
parameter, keeping the calibration's key **verbatim** so anything an older import already stored
still points at it; only the label, type and visibility are new. Header boxes are document metadata,
so they are kept off Log your run and out of analysis — a track name is not a setup change.

### The union redraws the whole sheet, not just its additions

Box geometry *and* look are read off the blank — nobody authored them — so `boxesJson` is a cache of
what that PDF says, and `applyUnionToChassis` rebuilds all of it from the same file on every run.
That is how a fix to the *reading* reaches boxes that already exist. Safe because it is the same call
that placed them: `derivedMappingsJson` is key → PDF field, exactly the shape
`boxesFromCalibrationMappings` reads. Still idempotent — a second run over an unchanged blank adds
nothing and restyles nothing.

### Looking like the sheet: what is measured, and what is still a guess

- **A tick's colour comes from the box's own ON picture** (`/AP /N`), not its `/DA` string. Acrobat
  paints the picture and never consults the `/DA` for a tick. 18 of the 434 tick widgets across the
  three repo blanks have a black or absent `/DA` while their picture paints red, and those 18 drew
  black. None of them are on the A800RR — this is an Xray fix.
- **Auto-sized text was measured, not chosen.** Every text field on these sheets says `0 Tf`, so the
  app decides every value's size. A real filled A800RR carries a baked appearance stream per box
  stating the size its viewer committed to: across 77 such boxes the size came to a median **0.723**
  of the box height (0.734 over the 73 whose height was the binding limit), and the implied character
  advance to 0.536. `AUTO_TEXT_HEIGHT_RATIO` moved 0.66 → 0.73 and `AVERAGE_ADVANCE` 0.55 → 0.54;
  the old numbers drew every value about 1.1pt small.
- **A multiline box wraps, so it is not sized to its height.** The same sheet's comments box is
  78.6pt tall and its viewer drew 11pt in it — a ratio of 0.14. The height rule made it five times
  too big and the one-imaginary-line width rule made it half size, which is what shipped. Multiline
  is now carried on the box (`DerivedBoxStyle.multiline`) and capped at a share of the *page* height.
  **Fitted to one real sample; Acrobat's multiline rule is not published.**
- **Camber and toe print unsigned.** The sign is the app's, added at import so every stored angle
  compares the same way across cars. No manufacturer sheet prints one — the printed caption carries
  the direction. `unsignedGeometryValueForPaper` strips it on the way to the PDF only, never in
  storage and never on screen, so a sheet uploaded reading 1.75 downloads reading 1.75.
- **Not attempted:** matching Acrobat's text rendering exactly. Both renderers are guessing at a size
  the file never states, and only one of the two algorithms is published.

---

## Confidence doctrine

Mirrors the Engineer's trust ethos (`ENGINEER_NORTH_STAR.md`): never bluff. Flag a
field when any of: the model self-reports low confidence · dual-pass extraction
disagrees · value fails range sanity vs the sheet model schema or the user's setup
history/community histograms · OCR text and LLM value disagree. Flagged-and-right is
fine; confident-and-wrong is the failure mode the eval punishes.

---

## Non-goals

- Replacing the manual calibration editor (it remains the power-user escape hatch).
- Extracting from video, hand-sketched notes, or non-setup documents.
- Auto-importing without any review path on low-confidence uploads.
