# RC Engineer — agent guide

Source of truth for every AI agent in this repo (Claude Code, Cursor, Codex). `CLAUDE.md`
just imports this file. Next.js PWA + iOS shell for RC car race engineering: run logging,
setup-sheet OCR, an LLM "Engineer", video/lap analysis. Solo-founder app; Jordan tests it himself.

## Commands (Windows / PowerShell)

- Typecheck: `npx tsc --noEmit`   ·   Lint: `npm run lint`   ·   Dev: `npm run dev`
- Local prod build: `npx next build`
- ⚠️ `npm run build` is the **Vercel** pipeline — it runs `prisma migrate deploy` first. Never use it locally.
- Tests: no global runner — ~45 granular `test:*` scripts, one per area (`npm run test:nav`,
  `test:roll-center`, `test:video-analysis`, …). Run the one matching what you changed; add a
  test if logic changed and nothing covered it.
- DB drift repair: `npm run db:migrate:reconcile`.   iOS: `npm run cap:sync` / `npm run cap:open`.
- Slow/costly, only when asked: `npm run engineer:eval`, `engineer:bench`, `setup-extract:eval`.

## Stack (facts you can't infer)

Next **16.2** App Router · React **19** · TypeScript strict (`@/*` → `src/*`) · Prisma **6** ·
NextAuth **5 beta** · Tailwind **v4** (`@tailwindcss/postcss`) · Capacitor **8** (iOS shell) ·
Vercel Blob storage · onnxruntime-node (local PP-OCR) · Phosphor + Lucide icons.

## Structure

`src/app` routes + `api/` · `src/components` · `src/lib` (42 domain folders — the real logic) ·
`prisma/` · `docs/` north-star specs · `content/vehicle-dynamics/` locked Engineer KB · `scripts/` ·
`ios/`, `hardware/`. Auth = allowlist magic-link + optional Google (`src/auth.ts`, allowlist in
`AuthAllowedEmail` + `AUTH_ALLOWED_EMAILS`; admins `src/lib/authAdmin.ts`). `src/middleware.ts`
gates everything except `/login`, `/privacy`, `/api/health/*`, `/api/_debug/version`.

## Hard rules

1. **IMPORTANT — never edit the Engineer KB without typed approval.** `content/vehicle-dynamics/*.md`
   (top level) **and** every entry in `src/lib/engineerPhase5/parameterEffects/catalog.ts` are
   quoted to drivers as ground truth. Do not modify/rewrite/"clean up" them unless the user's most
   recent message names the file or asks for KB edits — propose a diff in chat and wait. Drafts
   under `content/vehicle-dynamics/drafts/` are open (protocol in `docs/VEHICLE_DYNAMICS_PHYSICS_KB_ROADMAP.md`).
   For Engineer *behavior* changes, fix the prompt first: `openaiEngineer.ts`,
   `engineerRichContext.ts`, `vehicleDynamicsKb.ts` — surrounding code is normal, edit freely.
2. **IMPORTANT — never `prisma db push` against production.** It skips `_prisma_migrations` and
   breaks Vercel's `migrate deploy` (P3009 loop). Prod schema = committed migration + `migrate
   deploy` only; use a separate Neon branch for local dev. Repair drift with `db:migrate:reconcile`.
3. **No scope creep.** Change only what was asked; a visual pass is restyle-only (no behaviour,
   routing, or API changes). Flag a better approach in chat instead of quietly doing it.

## Talk to the founder: short, actionable, plain

**Answer in dot points, one line each.** No preamble, no closing summary paragraph, no narrating
options you won't take. **Never cap the number of points to hit a length target** — say everything
that matters, just say each thing in one line. Lead with what changed or what to do next. Plain
words; minimal jargon (explain it in one line if unavoidable). Code, paths, and commit messages
stay precise.

## Where to read before you start

Find your task; read that doc first. If nothing matches, you don't need one.

| If the task touches… | Read first |
|---|---|
| Any `.tsx` under `src/app` or `src/components` — styling, layout, visual rework | `docs/VISUAL_NORTH_STAR.md` |
| Engineer prompts, context, retrieval, suggestion surfaces, chat UX | `docs/ENGINEER_NORTH_STAR.md` |
| Engineer answer *quality* (evals, gold set, judge, benchmarks) | `docs/ENGINEER_SUGGESTION_QUALITY_PLAN.md`, `docs/ENGINEER_ITERATION.md` |
| What to build next / prioritization / "is this in scope" | `docs/PRODUCT_NORTH_STAR.md` |
| Dashboard content or layout | `docs/DASHBOARD_NORTH_STAR.md` |
| Setup sheet upload, import, OCR, calibration editor | `docs/SETUP_UPLOAD_NORTH_STAR.md` |
| Roll centre calculator | `docs/ROLL_CENTER_NORTH_STAR.md` |
| Video analysis or speed/steering traces | `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md`, `docs/VIDEO_TRACE_NORTH_STAR.md` |
| Driver-vs-driver sector compare, sector clips, driven-line overlay | `docs/SECTOR_COMPARE_NORTH_STAR.md` |
| PWA install, service worker, web push, notifications | `docs/PWA_NORTH_STAR.md` |
| iOS shell, Capacitor, TestFlight, native push | `docs/TESTFLIGHT.md` |
| Who can see or create what (access tiers, IDOR, global catalogs) | `docs/ASSET_ACCESS_NORTH_STAR.md` + `.cursor/skills/security-architect/SKILL.md` |
| Handling / rating capture on the run form | `docs/HANDLING_CAPTURE_NORTH_STAR.md` |
| First-run experience, empty states, `/welcome` set-up wizard | `docs/ONBOARDING_NORTH_STAR.md` |
| Race results, trophies | `docs/RESULTS_TROPHIES_NORTH_STAR.md` |
| Writing vehicle-dynamics KB drafts | `docs/VEHICLE_DYNAMICS_PHYSICS_KB_ROADMAP.md` |
| Claiming a feature exists, or "fixing" something that looks broken | `docs/NOT_YET_BUILT.md` — a spec is intent, not shipped code |

**Current state of in-flight work lives in `MEMORY.md`, not these specs.** If a memory says
"BUILT uncommitted" / "READ FIRST", trust it over a spec's status table — but verify the named
file still exists before acting.

## Things that will bite you

- **Setup aggregations are materialized** (`src/lib/setupAggregations/`) — after a change that
  affects stats, rebuild via `POST /api/setup-aggregations/rebuild` or numbers go stale silently.
- **Dev origins are pinned** in `next.config.mjs` (`allowedDevOrigins`) — an unlisted LAN IP
  serves pages that render but aren't clickable (hydration silently dies).
- **Commits:** work on a branch off `main`; don't commit or push unless asked. `Made-with:` trailers welcome.

## Verify your work

`npx tsc --noEmit` → the matching `test:*` → `npx next build` before shipping. Report honestly:
what changed, what you verified, what still needs eyes. Never call something working you haven't
seen work.

**IMPORTANT — never drive the app. Jordan does it himself.** No `npm run dev`, no headless
Chrome/CDP screenshots, no clicking through pages. Don't offer to, don't ask permission — it's
slow and he checks it anyway. Stop at `tsc` + tests + build, then say plainly what you couldn't
verify and what he should look at.
