# Engineer improver changelog

Session log for Engineer quality iterations. The **Engineer Improver** skill (`.cursor/skills/engineer-improver/SKILL.md`) appends one section per session.

**Success metric:** error rate (`failCount`, `wrong_physics`) decreases over time; ship bar passes consistently.

## How to read this file

| Column / field | Meaning |
|----------------|---------|
| **Ship bar** | PASS = avg reviewer ≥ 4/5 and zero `wrong_physics` |
| **Failures** | Eval cases with `pass: false` or pipeline `error` |
| **Δ** | Change vs previous session entry |
| **Results** | Path to `scripts/engineer-eval/results/<timestamp>.json` |

---

<!-- Sessions append below (newest first) -->

## 2026-06-20 — Baseline eval (15 starter gold-set cases)

| Field | Value |
|-------|-------|
| **Ship bar** | **FAIL** |
| **Failures** | **2 / 15** |
| **wrong_physics** | **1** |
| **Avg reviewer score** | **4.13 / 5** |
| **Results** | `scripts/engineer-eval/results/2026-06-20T03-19-14-224Z.json` |
| **Δ vs prior** | First scored baseline (prior session had no eval) |

**Eval config:**
- Eval user: `jordancaaruso@gmail.com` (not in `.env.local`; resolved via latest run owner).
- Gold set: 15 starter cases in `gold-set.json`; run/compare ids auto-filled from founder's latest two runs.
- `npm run engineer:eval` hit OpenAI TPM limits (gpt-4o ~21k tokens/call, 30k TPM org cap); completed via sequential runner with 60–90s inter-case delay + retry for 2 rate-limited cases.

**Reviewer failures:**
| Case | Score | Tags |
|------|-------|------|
| `under-lower-vs-upper` | 2/5 | `wrong_physics`, `missing_kb_citation` |
| `community-spread` | 3/5 | `missing_kb_citation`, `ignored_context` |

**Status:** Baseline recorded. No code/KB changes applied — awaiting founder WHY on failures before proposing fixes.

---

## 2026-06-20 — Session started (Phase 1 gather)

| Field | Value |
|-------|-------|
| **Ship bar** | — (no eval run yet) |
| **Failures** | — / — |
| **wrong_physics** | — |
| **Avg reviewer score** | — |
| **Results** | — |
| **Δ vs prior** | First session — no baseline |

**Gather notes:**
- Applied pending migration `20260620140000_engineer_gold_set_candidates` (`npm run db:migrate:deploy`).
- Gold-set candidates: **0** pending (table was empty post-migration; no prior captures).
- Tester ratings: **0** total (`EngineerMessageRating` table exists, empty).
- Eval results: none in `scripts/engineer-eval/results/`.
- Starter gold set: **15** cases in `gold-set.json` (all `runId`/`compareRunId` null).
- `ENGINEER_EVAL_USER_ID` / `ENGINEER_EVAL_USER_EMAIL`: not set in `.env.local`.
- Engineer chat persistence: **0** threads / **0** messages on connected DB.
- `docs/ENGINEER_FEEDBACK_LOG.md`: template only — no founder paste entries.

**Status:** Phase 2 report delivered — awaiting founder signal (eval approval or real Q&A captures). No code/KB changes applied.
