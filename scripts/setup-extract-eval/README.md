# Setup-sheet extraction eval (Stage 0)

Gold-set eval for the AI vision extraction path — see `docs/SETUP_UPLOAD_NORTH_STAR.md`.

## Run

```
npm run setup-extract:eval               # everything with expected values
npm run setup-extract:eval -- coelho     # filter by filename substring
SETUP_EXTRACT_MODEL=gpt-4.1 npm run setup-extract:eval
```

Needs `OPENAI_API_KEY` in `.env.local`. Costs real money (2 vision calls per sheet).

## Scoring

Per field: **correct** / **wrong-but-flagged** (confidence < 0.8 — review catches it) /
**wrong-confident** (the failure that burns trust). Ship bar: correct-or-flagged ≥ 95%.

## Layout

```
gold/<style>/schema.json       extraction target (field keys, labels, choice options)
gold/<style>/files/            sheet images + blank AcroForm PDF (committed; public PetitRC sheets)
gold/<style>/expected/<f>.json gold values; status: draft (Claude-transcribed) | verified (Jordan checked)
results/                       raw model outputs per run (gitignored)
```

## Gold hygiene

- `status: "draft"` = transcribed by Claude from the image; verify before trusting a
  regression signal on that sheet — the transcriber and the extractor share failure modes.
- Value formatting is forgiving (units, case, decimal commas are normalized); use
  `{ "value": ..., "accept": [...] }` for genuine alternates ("10k" vs "10000").
- Blank on the sheet = `""` — blanks are load-bearing tests (they punish hallucination).
