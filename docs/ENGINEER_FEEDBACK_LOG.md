# Engineer feedback log (founder paste workflow)

Use this file to capture **real test-day Q&A** that should enter the gold regression set or prompt/KB iteration backlog.

## When to paste

- After every test day (ideal)
- Whenever a tester flags a bad Engineer answer in-app
- When you spot a pattern in Settings → **Engineer feedback (admin)**

## Paste template

Copy one block per exchange:

```markdown
### YYYY-MM-DD — short label

**Source:** test-day | replay | synthetic | hypothetical  
**Run:** `<runId>` (optional compare: `<compareRunId>`)  
**Question:**  
(paste exact user question)

**Answer:**  
(paste Engineer reply)

**Founder verdict:** good | ok | bad  
**Notes:** (what was wrong / missing — physics, hedge, context, KB cite)  
**Tags:** handling | physics | compare | laps | …  
**Action:** prompt | context | catalog | none  
```

## Promote to gold set

1. For regressions you want automated every week, add a case to `scripts/engineer-eval/gold-set.json`:
   - Stable `id`
   - `question` verbatim
   - Real `runId` / `compareRunId` when the answer depends on your data
2. Re-run `npm run engineer:eval` and confirm reviewer avg ≥ 4/5 with no `wrong_physics` flags.
3. Keep this log as the human audit trail; the JSON gold set is the machine regression.

## Bulk founder eval (50+ / week)

1. Collect questions here (test-day + replays + synthetics).
2. Append new rows to `gold-set.json` or a week-specific JSON file (`--gold=...`).
3. Run batch eval (see `docs/ENGINEER_ITERATION.md`).
4. Review **only** failures and `wrong_physics` in the results JSON — not every exchange.

## In-app tester ratings

Testers rate with **1–5 stars** under any Engineer message + optional note. Context (question, answer, run ids, KB sections) is captured automatically — you do not need to duplicate those in this log unless you want a narrative note.
