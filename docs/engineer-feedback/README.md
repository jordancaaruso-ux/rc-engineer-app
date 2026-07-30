# Engineer feedback inbox

Agent-readable export of **founder-only** (admin) **0–10** Engineer ratings. Testers do not rate; only `AUTH_ADMIN_EMAILS` users can submit ratings and appear in export.

| File | Purpose |
|------|---------|
| `inbox.jsonl` | One JSON object per line — **primary signal** for `@engineer-improver` |
| `inbox.md` | Human skim rollup (same data) |

## Regenerate

Ratings are canonical in the database (`EngineerMessageRating`), filtered to admin users only.

### Settings (primary)

**Settings → Engineer feedback (admin) → Export feedback** (admin / T6 only).

- **Local dev:** writes `docs/engineer-feedback/inbox.jsonl` and `inbox.md` in the repo.
- **Production:** downloads `engineer-feedback-inbox-YYYY-MM-DD.zip` (both files).

Saving a rating in **local dev** also refreshes these files automatically.

### CLI (local)

```bash
# After test days, or before "improve engineer" in Cursor:
npm run engineer:export-feedback
```

Point `.env.local` at the target database (e.g. production Neon branch) when exporting from your machine.

### Export just one batch

To hand an agent only the answers you care about, filter instead of hand-trimming the file —
a hand-edited `inbox.md` is silently overwritten by the next export and stops matching
`inbox.jsonl`. A filtered export labels itself **Partial export** in the markdown header.

```bash
npm run engineer:export-feedback -- --limit 4                       # 4 most recent ratings
npm run engineer:export-feedback -- --since today                   # rated today (local midnight)
npm run engineer:export-feedback -- --since 2026-07-29              # rated on/after a date
npm run engineer:export-feedback -- --prompt-version 2026-07-30+ab12cd34
```

Flags combine; `--limit` applies last (so "the N most recent that match"). Unknown flags and
bad values fail loudly rather than quietly exporting the whole history.

`--prompt-version` matches the Engineer build that produced the answer — the label plus a
fingerprint of the system prompt, stamped into each rating snapshot
(`src/lib/engineerPhase5/promptVersion.ts`). Bump `ENGINEER_PROMPT_LABEL` when you change
Engineer behaviour you want to measure as its own batch; prompt-text edits move the
fingerprint on their own. Ratings from before this was added export with no prompt version.

⚠️ Saving a rating in **local dev** rewrites both files *unfiltered* — re-run the filtered
command afterwards if you were working from a narrowed export.

## Commit?

You may commit `inbox.jsonl` / `inbox.md` after export so agents see real feedback without DB access, or leave them untracked and rely on Settings export / the CLI command.
