# Engineer iteration ritual

Day-to-day loop to improve Engineer quality using **real in-app Q&A** with full run/setup context.

## Primary loop (founder day-to-day)

1. **Ask in Engineer** — use the app with real runs/setups attached (context is always captured).

2. **Rate each reply 0–10** + note what was wrong (note encouraged when score ≤ 6). **Admin only** (`AUTH_ADMIN_EMAILS`) — testers do not see rating UI.

3. **Export for agents** — after a test day or before Cursor iteration:

   - **Settings → Engineer feedback (admin) → Export feedback** (primary UX)
   - Or locally: `npm run engineer:export-feedback`

   **Dev:** writes `docs/engineer-feedback/inbox.jsonl` (agent primary) and `inbox.md` (human skim). Saving a rating also refreshes these files locally.

   **Production (Vercel):** downloads `engineer-feedback-inbox-YYYY-MM-DD.zip` (`inbox.jsonl` + `inbox.md`) — serverless cannot write to the repo.

4. **Improve in Cursor** — say **"improve engineer"** (loads `.cursor/skills/engineer-improver/SKILL.md`). Agent reads the inbox first, asks you WHY when notes are empty, proposes prompt/context/retrieval fixes.

## Roles

| Who | What |
|-----|------|
| **Founder** | Ask + rate in app (admin only); export via Settings or CLI; invoke improver in Cursor |
| **Testers** | Use Engineer chat only — no ratings, no export |
| **AI reviewer** | Second pass on gold-set batch eval — score 1–5 + tags (regression only) |

## Secondary: gold-set + batch eval (~weekly)

Gold-set auto-capture (Settings → **Gold-set candidates**) and `npm run engineer:eval` remain useful for **regression after fixes**, not the primary feedback path.

1. **Collect** — Settings → **Engineer feedback (admin)** or export inbox.
2. **Review queue (optional)** — Settings: promote good auto-captured cases to gold set.
3. **Sync (optional)** — `npm run engineer:sync-gold-set` → `scripts/engineer-eval/gold-set-auto.json`.
4. **Run regression + reviewer:**

```bash
npm run engineer:eval
# include auto-exported promoted cases:
npm run engineer:eval -- --include-auto
# or read promoted rows directly from DB:
npm run engineer:eval -- --include-db-promoted
```

Optional flags:

```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/engineer-eval/run-eval.ts \
  --gold=scripts/engineer-eval/gold-set.json \
  --user-id=<founderUserId> \
  --concurrency=2
```

Env:

- `ENGINEER_EVAL_USER_ID` or `ENGINEER_EVAL_USER_EMAIL` — whose runs load when a case has null run ids
- `ENGINEER_MODEL` — Engineer chat model (default from app)
- `ENGINEER_REVIEWER_MODEL` — cheaper reviewer (default `gpt-4o-mini`)

5. **Review failures only** — Open `scripts/engineer-eval/results/<timestamp>.json`. Fix prompt/context in code; re-run until ship bar passes.
6. **Ship bar** — **Avg reviewer score ≥ 4/5** and **zero `wrong_physics` tags** on the gold set.

## After prompt / context changes

Always re-run `npm run engineer:eval` before shipping. Founder reviews flagged rows only.

## Engineer quick fix (in-app)

**Engineer quick fix** is a structured, on-page suggestion card (dashboard last run, run detail after handling, Engineer when `runId` is focused). It posts to `POST /api/engineer/quick-fix` with the same run visibility rules as setup snapshot / peer sessions. **Dig deeper** opens `/engineer?runId=…&prompt=…` to prefill chat. Unit tests: `npm run test:quick-fix`.

## AI-review rubric (reviewer tags)

| Tag | Meaning |
|-----|---------|
| `wrong_physics` | Contradicts KB / RC shim conventions — **blocks ship** |
| `missing_kb_citation` | Setup direction without KB grounding |
| `overconfident` | Too definitive for thin context |
| `ignored_context` | Obvious run/compare/setup context unused |
| `good_hedge` | Appropriate uncertainty |
| `good_grounding` | Solid KB / context use |

## Cost notes (50-question week)

Rough order of magnitude with defaults (`gpt-4o` Engineer + `gpt-4o-mini` reviewer, concurrency 2):

- **~50 Engineer turns** — largest cost (full context + tools); ~$5–8 depending on context size
- **~50 reviewer calls** — small JSON replies; ~$0.50–1.50
- **Wall time** — ~25–45 min batch (2 concurrent); run off-peak

Tune down cost: lower concurrency, `ENGINEER_LIGHT_MODEL` for eval-only, trim gold set for daily smoke vs weekly full 50+.

## Legacy / optional

- **`docs/ENGINEER_FEEDBACK_LOG.md`** — manual paste audit trail (optional; inbox export replaces day-to-day paste)
- **Synthetic question generator** — not built yet
- **Auto-import low scores into eval queue** — use inbox export + improver instead
