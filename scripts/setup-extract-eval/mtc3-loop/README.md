# MTC3 image-accuracy convergence loop

Self-verifying accuracy loop for Mugen MTC3 setup-sheet **image** uploads (screenshots of the
digitally-filled editable PDF). Ground truth is free: fill the editable AcroForm
programmatically (values are known), render page 1 with headless Chrome + the repo's pdfjs,
degrade to screenshot-like JPGs, then diff the image pipeline's reads against the AcroForm
values. No manual labeling.

The reader in `mtc3-common.ts` MIRRORS `src/lib/setupCalibrations/imageExtractPipeline.ts`
(server-only, not importable from tsx). **Any change validated here must be ported there, and
vice versa.** Ported 2026-07-14: content-box alignment, redness/gap mark detection, fill-in
line removal, neutral OCR labels, consensus OCR (shifted-chunk double pass + gpt-4o tiebreak).

## Files

| Script | Purpose |
|---|---|
| `gen-synthetics.ts` | Build/refresh the test set: 5 seeded synthetic fills + the Soren case → `cases/` (jpg + gold.json) |
| `score.ts` | Read every case through the LIVE calibration, diff vs gold. `--choices-only` (free, no OCR), `--runs=2`, `--case=case-01` |
| `score-padded.ts` | Letterbox + ⅓-screen (center/corner, light/dark desktop) regression; `--with-ocr` for full text |
| `score-ronald.ts` | Real PetitRC case (Ronald Volker) — prefer `setup.jpg` from the page, not a browser-window screenshot |
| `compare-align-ocr.ts` | Full OCR: case-01 vs a padded variant; every field must agree |
| `read-real.ts --img=<path>` | Read any real jpg (no gold); prints all values for eyeballing |
| `nudge-region.ts` | Targeted live region fix: `--key=X --trim-left=0.1` or `--set='{json}'`; dry-run default, `--apply` writes |
| `set-content-box.ts` | Recompute + persist `reference.contentBox` from a blank render |
| `dump-crops.ts` / `ocr-experiment.ts` | Diagnosis: save 4x crops for keys; A/B OCR prompts on crops |
| `fix-hex-width.ts` | One-off: snapped hex_width options to AcroForm widgets |
| `mtc3-common.ts` | Shared: live cal loader, AcroForm geometry, gold extraction, production-mirror reader, tolerant scorer |

Run everything via `npx dotenv-cli -e .env.local -- npx tsx scripts/setup-extract-eval/mtc3-loop/<script>`.

## The loop

```
gen-synthetics (once, or after calibration structure changes)
  → score --choices-only --runs=2   (fast: marks + alignment)
  → score-padded                    (screenshot letterbox regression)
  → score --runs=2                  (full OCR, slow)
  → for each FAIL: dump-crops → classify (region / OCR / mark-gate)
      region  → nudge-region --apply    (live DB, instant)
      OCR     → fix in mtc3-common reader, then PORT to imageExtractPipeline.ts
      gate    → fix detection logic, then PORT
  → repeat until 100% twice
  → compare-align-ocr / read-real on real JPGs (final exam — different renderer geometry)
```

## Key findings (2026-07-14, all validated on the gold set)

- **Redness beats darkness for marks**: editable-PDF checkbox appearances render red;
  `mean(max(0, R-(G+B)/2))` is ~0 for print/blue-text/paper. Dominance guard vs the group
  MINIMUM (a median lands on a mark when half the group is marked). Fallback: largest-gap
  darkness clustering (absolute gates don't transfer across render resolutions).
- **Mark styles are homogeneous per sheet** (2026-07-15, from a real PetitRC black-mark
  sheet): if ≥3 groups fire the red test, the sheet is red-style → no-red groups are simply
  unmarked; otherwise (black-style, e.g. PetitRC renders) use the gap path. Per-option
  blank-render baselines were tried and REJECTED: print weight differs between renderers.
- **Measure the box CENTER, not the whole box** (the key black-mark fix, 2026-07-15): a mark
  (dot/X) concentrates in the checkbox center; printed labels and diagram lines that clip a
  box edge sit at the periphery. Measuring the inner 55% (`GROUP_OPTION_CENTER_FRACTION`)
  turns faint black marks — full-box gap ~0.024, *overlapping* printed-label bias ~0.018, so
  no full-box threshold separates them — into large center gaps ~0.12 (marked center ~0.30,
  unmarked ~0.15). Black-style `MIN_GAP` is then a comfortable 0.05. Applies to red marks too.
- **Faithful black-mark gold case**: case-06 grayscales the sheet AND composites solid black
  dots at the chosen option centers (`compositeBlackMarks`, `blackMarks` in gen-synthetics),
  with gold taken from those choices — a real PetitRC-style render, not greyed-red glyphs
  (which were unrealistically faint). A real PetitRC sheet lives at `cases/petitrc-real.jpeg`
  (fetch-blob.ts pulls uploads from Vercel blob via BLOB_READ_WRITE_TOKEN).
- **The consensus-OCR run legitimately takes 60–120s** on a ~73-text-field sheet. Production
  `mapExtractedImageWithCalibration` cap raised 45s→180s and the upload routes carry
  `maxDuration=300`; the 45s cap was killing the read and leaving the stale basic parse.
- **Semantic OCR labels hallucinate signs**: `[camber_rear]` primes "camber is negative" →
  reads "2" as "-2". Neutral aliases (f1…) fix it. Survived re-chunking and model upgrades —
  it was actually `interpretAwesomatixSetupSnapshot` applying the app's canonical sign
  convention (front toe/camber negative); the scorer canonicalizes gold through the same fn.
- **Stacked-crop OCR errors are chunk-composition-dependent** → consensus: two passes with
  shifted chunk boundaries; disagreements solo-tiebroken on gpt-4o.
- **Fill-in lines read as minus signs** → whiten any crop row ≥70% dark.
- **Different renderers shift geometry** (real jpg aspect 1.427 vs ref 1.415 → one-row-down
  misreads). Content-box alignment: box→box mapping, identity-snap within 0.5%.
- **Screenshot margins / small-in-frame** (2026-07-18): band-argmax and “must be ≥40% of the
  image” both fail real PetitRC-style screenshots (sheet in ~⅓ of a desktop window). Detector
  now: (1) dark-desktop → bright paper island, refine frame on that crop; (2) score border
  rectangles by local edge ink + paper interior + aspect match to the blank; (3) light-desktop
  fallback = bounding box of ink. Sample at up to 1600px so thin borders survive. Validate with
  `score-padded.ts` (letterbox + third-center/corner × light/dark).

## Converged state

2026-07-14: **1236/1236 (100%) across 6 sheets × 2 runs** (5 synthetic + Soren) pre-alignment;
re-verified after content-box alignment landed. Real `mugen-test-setup.jpg` reads clean
(header prose, all numerics, choice groups) — founder eyeball + green-light pending.

2026-07-18 (screenshot letterbox + ⅓-screen):
- Choices: **30/30** on pad-10% / pad-18% / asymmetric **and** third-center/corner × light/dark.
- Full OCR: **103/103** on 6/7 padded variants; one flaky text field on third-center-light
  (`above_rear_wheel_arch_height` 4.9→14.9) — OCR under heavy downscale, not a wrong crop.
- Workbench green-light for MTC3 still needs founder eyeball of 1–3 real filled sheets at
  `/setup-sheet-models/<mtc3-id>`.

## Generalizing to other cars

The mechanism needs per-model inputs: the editable AcroForm blank (geometry + fill target),
`formFieldMappings` on the model's calibration (schemaKey → pdfFieldName), and a rendered
reference. Parameterize `MTC3_*` constants in `mtc3-common.ts` (model id, cal id, gold dir)
— everything else is model-agnostic. Mark-color assumption (red) holds for any sheet whose
editable PDF renders red appearances; the gap fallback covers the rest.
