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

## Commit?

You may commit `inbox.jsonl` / `inbox.md` after export so agents see real feedback without DB access, or leave them untracked and rely on Settings export / the CLI command.
