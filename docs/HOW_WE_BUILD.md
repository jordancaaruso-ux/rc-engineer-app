# How we build — quality bar & the build loop

The engineering counterpart to the north stars. `PRODUCT_NORTH_STAR.md` says *what* to
build; `VISUAL_NORTH_STAR.md` says *what it looks like*; `AGENTS.md` holds the hard
guardrails (KB lock, prod-DB rules, auth). **This doc says one thing: when a change is
actually done.**

The goal is world-class and shippable. That means no change is "done" because the code
was written — it's done when it has been **run and observed to work**.

---

## Definition of Done

Before a change is called complete:

- [ ] **It ran.** I drove the real thing — the route, the script, the flow — and watched it behave. Not "should work."
- [ ] **It compiles.** `npx next build` passes (the same TypeScript + lint gate Vercel uses). Fast inner-loop type check: `npx tsc --noEmit`.
- [ ] **Tests cover the change.** The relevant `test:*` script passes; if logic changed and nothing covered it, I added or updated a test.
- [ ] **No scope creep.** I changed only what was asked. Visual work = restyle only (`VISUAL_NORTH_STAR.md`) — no behavior or API changes smuggled into a UI pass.
- [ ] **Honest report.** I state what I verified and what I didn't. "I couldn't test X because Y" beats silence.

---

## The build loop

**Plan → change → run it → observe → fix → repeat**, until the Definition of Done is met.

The loop only closes if there is a signal to check against. Each task, pick the cheapest
signal that actually *proves* the change:

| If the change is… | Prove it with |
|---|---|
| Types / compile | `npx tsc --noEmit`, then `npx next build` before shipping |
| Pure logic (Engineer, laps, setup math) | the matching `test:*` script — fast, free, offline |
| UI / route behavior | run it: `npm run dev` and drive the flow (or the `/verify` skill) |
| Engineer answer quality | `npm run engineer:eval` — slow, costs OpenAI $, needs `.env.local`; run deliberately, not every iteration |

If I can't close the loop, I don't pretend it's done — I say what's unverified and why.

---

## Signals in this repo

**Fast + free — run liberally:**

- Types: `npx tsc --noEmit` · Compile + lint: `npx next build` · Lint only: `npm run lint`
- Unit tests: `npm run test:intent`, `test:reasoning-spine`, `test:quick-fix`, `test:engineering-read`, `test:grip-spread`, `test:video-analysis`, … (full list: `scripts` in `package.json`)

**Slow / costly — run deliberately:**

- `npm run engineer:eval` — gold-set eval; run before/after Engineer prompt, retrieval, or rich-context changes.

**Skills that close the loop:**

- `/verify` — drive a change end-to-end and observe before commit.
- `/run` — launch and drive the app when I need to see it in the browser.
- `/code-review` — scan the working diff for bugs + cleanups; run on anything nontrivial before shipping.

---

## Shipping

- Work on a branch off `main`; don't commit or push unless asked.
- Commit only once the Definition of Done is met. Commit trailers welcome (`Made-with:`) for auditability.
- **Never** run `npm run build` or `prisma db push` against a prod-pointed `.env.local`. Production schema changes are committed migrations + `migrate deploy` only (see `AGENTS.md`). Note: `npm run build` is the *Vercel* pipeline — it runs `prisma migrate deploy` **first**, then `next build`. Locally, prefer `npx next build`.
