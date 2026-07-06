# Setup Upload North Star — any sheet, accurate every time

**Status:** Locked from founder interview (2026-07-06). **Owner:** Jordan.

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

### Stage 1.5 — AI-drafted schemas for unknown cars

- Upload for a car with no sheet model → AI proposes the full schema for review;
  approved schemas go to admin for community promotion.
- **Universal-parameter mapping is mandatory, not optional** (see below). Every drafted
  field that is a cross-car concept MUST carry its `universalParameterId`, or that car
  silently drops out of community aggregations. The drafter is given the canonical
  registry and told to reuse those ids for universal concepts;
  `suggestUniversalParameterId()` is the backstop/validator for novel field names.

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
