# Naming a chassis's setup-sheet boxes

What this does: for one chassis, reads the blank PDF, shows a helper a picture of every box, and
writes back a name a driver would recognise. Two helpers name every box independently and only the
boxes where both agreed AND both were confident are marked ready. Everything else stays unnamed
rather than wrong — that rule measured 98-100% right on the two sheets Jordan had named by hand.

Nothing here touches the app or the database. Results land in a work folder as files.

## Once per sheet

```bash
# 1. Which sheets are worth doing, most-raced first
npm run sheets:catalog -- --limit=40

# 2. Cut the pictures and the batch files (one picture per box, 8 boxes per batch)
npm run sheets:prep -- --name="Xray X4'26" --work=<scratch>/sheets --batch=8
#    -> <scratch>/sheets/<slug>/ with page.png, page-grid.jpg, crops/, batch-NN.json, sheet.json
```

**3. The layout briefing.** Send one Opus helper to read `page-grid.jpg` (the page with a labelled
0.1 grid on it) and write `layout.md`: every printed block with its rectangle and which end of the
car it serves, plus a "Traps" section. This is the step that stops rear boxes being named front. It
costs about 230k tokens and takes 15-20 minutes for one sheet.

```bash
# 4. Fold the briefing into the rules every naming helper reads
npm run sheets:instructions -- <scratch>/sheets/<slug>
```

**5. The naming.** Two helpers per batch, writing to `labels-a/batch-NN.json` and
`labels-b/batch-NN.json`. Twenty helpers can run at once, so a 25-batch sheet is three waves. Each
helper's prompt is four lines: read `instructions.md`, read its batch file, read each box picture,
write its answers.

```bash
# 6. Apply the keep rule and build the page to review
npm run sheets:assemble -- --work=<scratch>/sheets/<slug>
npm run sheets:review -- <scratch>/sheets/<slug>
```

`assemble` writes `ready.json` (the names that passed) and `review.json` (every box with both
passes' answers). `review` turns that into one page: the sheet with every box outlined by verdict,
beside the list of names.

## What it costs

Measured on the X4'26 (200 boxes): about 105k tokens per 8-box batch, so roughly 13k per box per
pass, 27k per box for the pair. Plus the one layout briefing.

The cost is driven by how many pictures a helper opens, not by how big they are — each new picture
re-reads everything already open, so the bill grows with the square of the batch size. That is why
each box gets ONE composite picture (close-up over wider view over whole page) and why batches are
8, not 16. Those two changes together cut the bill about fourteenfold.

## Known gaps

- **Page one only.** `parseBlankAcroFormGeometry` reads page 1; 1 of the 232 catalogued sheets has
  more than one page and would need the crop step taught about pages.
- **Results stay in files.** Writing `ready.json` into `SetupSheetBlank.boxNameSuggestionsJson`, and
  the v2 namer into `src/lib/setupExtractAi/draftCalibrationFromBlankSheet.ts`, are both still owed.
- **Resume is by hand.** A batch whose helper died just needs that one helper run again; the
  assemble step reports which boxes are missing from each pass.
