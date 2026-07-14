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
  → score --runs=2
  → for each FAIL: dump-crops → classify (region / OCR / mark-gate)
      region  → nudge-region --apply    (live DB, instant)
      OCR     → fix in mtc3-common reader, then PORT to imageExtractPipeline.ts
      gate    → fix detection logic, then PORT
  → repeat until 100% twice
  → read-real on real JPGs (final exam — different renderer geometry)
```

## Key findings (2026-07-14, all validated on the gold set)

- **Redness beats darkness for marks**: editable-PDF checkbox appearances render red;
  `mean(max(0, R-(G+B)/2))` is ~0 for print/blue-text/paper. Dominance guard: max ≥ 3× group
  median. Fallback: largest-gap darkness clustering (absolute gates don't transfer across
  render resolutions).
- **Semantic OCR labels hallucinate signs**: `[camber_rear]` primes "camber is negative" →
  reads "2" as "-2". Neutral aliases (f1…) fix it. Survived re-chunking and model upgrades —
  it was actually `interpretAwesomatixSetupSnapshot` applying the app's canonical sign
  convention (front toe/camber negative); the scorer canonicalizes gold through the same fn.
- **Stacked-crop OCR errors are chunk-composition-dependent** → consensus: two passes with
  shifted chunk boundaries; disagreements solo-tiebroken on gpt-4o.
- **Fill-in lines read as minus signs** → whiten any crop row ≥70% dark.
- **Different renderers shift geometry** (real jpg aspect 1.427 vs ref 1.415 → one-row-down
  misreads). Content-box alignment: argmax border-line detection per edge band, box→box
  mapping, identity-snap within 0.5%.

## Converged state

2026-07-14: **1236/1236 (100%) across 6 sheets × 2 runs** (5 synthetic + Soren) pre-alignment;
re-verified after content-box alignment landed. Real `mugen-test-setup.jpg` reads clean
(header prose, all numerics, choice groups) — founder eyeball + green-light pending.

## Generalizing to other cars

The mechanism needs per-model inputs: the editable AcroForm blank (geometry + fill target),
`formFieldMappings` on the model's calibration (schemaKey → pdfFieldName), and a rendered
reference. Parameterize `MTC3_*` constants in `mtc3-common.ts` (model id, cal id, gold dir)
— everything else is model-agnostic. Mark-color assumption (red) holds for any sheet whose
editable PDF renders red appearances; the gap fallback covers the rest.
