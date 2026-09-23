---
paths:
  - "src/lib/engineer/**"
  - "src/app/engineer/**"
  - "src/app/api/engineer/**"
  - "content/**"
  - "scripts/engineer-eval/**"
---

# The Engineer

Read `docs/ENGINEER_NORTH_STAR.md` before touching the prompt, payload, KB or nets.

- `src/lib/engineer/` is the whole Engineer: KB loader, short prompt, block-based payload builder,
  transport (`DEBUG_ENGINEER_WIRE=1` prints the real request), persistence and ratings. Chat is the
  only surface; the old quick-fix, hints and dashboard suggestions are deleted, not dormant.
- The payload's cache-stable order is enforced in code. Keep it that way.
- Every behaviour change goes through the eval harness (`scripts/engineer-eval/`) before it ships.
- When Jordan makes a ruling, add its key sentence to `scripts/engineer-eval/rulings.json`. The
  deploy roll-call checks every ruling against the code that ships.
- Jordan's reviews of Engineer answers are logged in `docs/ENGINEER_REVIEW_LEDGER.md`.
