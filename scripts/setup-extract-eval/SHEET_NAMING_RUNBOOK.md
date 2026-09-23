# Naming a chassis's setup-sheet boxes

What this does: for one chassis, reads the blank PDF and writes back, for every fillable box, the name
a racer would use ("Front upper inner shims, rear link (FR)", not "Box 12 · page 1, upper left").
Two helpers name every box independently; only boxes where both agree AND both are confident are
marked ready. Everything else stays unnamed rather than wrong.

Nothing here touches the app or the database. Results land in a work folder as files.

## The method (v3, 2026-09-23): name whole drawings, not single boxes

Earlier versions cropped each box around itself. On sheets whose boxes print only "SHIMS" or "mm",
the leader line left the frame before reaching the part, so boxes came back named by position ("top
row, 2nd box"). v3 cuts every printed block — a drawing plus all the boxes that point into it — from
a 6x render, outlines and tags every box, and one helper names the whole block at once, following each
line to its part. A primer (`naming-prompts/PRIMER.md`) teaches how setup-sheet drawings work and what
each shim position is called in the app's own words.

```bash
# 1. Which sheets are worth doing, most-raced first
npm run sheets:catalog -- --limit=40

# 2. Render, cut per-box pictures, write the manifest (with each tick box's own rectangle)
npm run sheets:prep -- --name="ARC A11" --work=<scratch>/sheets-v3
#    -> <dir>/ page.png, page-grid.jpg, page-grid-boxes.jpg, manifest.json, crops/, sheet.json
```

**3. The layout helper.** One Opus helper with `naming-prompts/LAYOUT-TASK.md` (CAR NAME, WORK
FOLDER) writes `blocks.json` (the naming units: each drawing with its callouts, with which way the car
faces in it) and `layout.md` (the briefing, with a "Traps" section).

```bash
# 4. One tagged picture per block, from a 6x render
npm run sheets:blocks -- --work=<dir>
#    -> <dir>/blocks/part-NN.jpg / part-NN.json / part-NN-page.jpg / index.json

# 5. Rules + primer + this sheet's briefing -> instructions.md
npm run sheets:instructions -- <dir>
```

**6. The naming.** Two helpers per block with `naming-prompts/BLOCK-NAMING-TASK.md` (WORK FOLDER,
PART NN, PASS a or b), writing `labels-a/part-NN.json` and `labels-b/part-NN.json`. Use agent type
`sheet-namer` (`.claude/agents/sheet-namer.md`: Read + Write only, model opus). Twenty at a time.

```bash
# 7. Apply the keep rule, then build the page to review
npm run sheets:assemble -- --work=<dir> [--min-confidence=0.8]
npm run sheets:review -- <dir> [out.html]
```

The keep rule compares names by meaning, not wording: extra detail on one side is fine ("ESC" /
"ESC (speed controller)"), a contradiction is not (front/rear, FF/FR, inner/outer, left/right,
upper/under), and the same cross-car parameter id on both sides counts as agreement.

## Measured

Answer keys live in `naming-gold/`: `arc-a11-gold.cjs` (built from the 6x render and ARC's A11
manual) and `mtc3-gold.json` (Jordan's own names, rebuilt from his calibration with
`build-gold-from-calibration.ts`).

| Sheet | Method | Right per pass | Shipped at 0.8 | Shipped wrong |
|---|---|---|---|---|
| ARC A11 | per-box (v2) | 92 / 110 | 56 | 0 |
| ARC A11 | whole-drawing (v3) | 110 / 110 | 93 | 0 |
| Mugen MTC3 | whole-drawing (v3) | 78 same + 27 close / 118 (token overlap vs Jordan's words) | 70 | 0 |

On the MTC3 almost every remaining "miss" is the same part in different words (Jordan's "Uptravel
Limit" = up-stop, "Above Hub Shims" = upper outer shims). Checked name by name, everything shipped was
right at 0.8, 0.7 and 0.6. The helpers' shared mistakes sat at 0.45-0.6 confidence (hex width read as
an eccentric insert, fixed since by a primer line), so 0.7 keeps a margin; 0.8 is still the default.

## What it costs

Measured 2026-09-23: 104.7M raw tokens for the ARC and the MTC3 together (two layout helpers, 94 block
helpers, 4 re-runs) — about 52M per 150-box sheet, roughly 2.5x the per-box method. Half of it is each
helper's ~61k-token starting context (project instructions, memory index, every tool definition)
re-read on each of its ~8 steps; the `sheet-namer` agent type strips that to Read + Write and should
cut it sharply (not yet measured: agent types load at session start). Five long helpers (the two
layouts and the two hardest drawings) used 25M between them.

## Known gaps

- **Japanese sheets render without their words.** `src/lib/setupDocuments/pdfServerRaster.ts` passes
  no `cMapUrl`, so CJK text drops (Yokomo MS2.0 came out as blank heading bars). Fix before naming them.
- **Page one only.** `parseBlankAcroFormGeometry` reads page 1 (1 of 232 catalogued sheets has two).
- **Results stay in files.** Writing `ready.json` into the app, and the reviewed names, is still owed.
- **Resume is by hand.** A block whose helper died needs that one helper run again; `assemble`
  reports which boxes are missing from each pass.
