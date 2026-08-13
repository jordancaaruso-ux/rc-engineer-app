# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Counts and paths below were verified against the tree on 2026-08-12; if one disagrees with the code,
the code is right — fix the line.

RC car race-engineering app for competitive 1/10-scale radio-control racing: log every on-track run,
import lap times from public timing sites, read setup sheets out of manufacturer PDFs, and ask an
LLM "Engineer" what to change next. Next.js 16 App Router + React 19 + Prisma/Postgres (Neon),
deployed on Vercel (`syd1`), also shipped as a PWA and an iOS Capacitor shell. Solo-founder product,
live with paying users — production is not a hypothetical.

## Commands

```
npx tsc --noEmit          # typecheck — the first gate
npm run lint              # eslint
npm run dev               # dev server
npx next build            # LOCAL production build
```

- **`npm run build` is the Vercel pipeline**, not a local build: it runs `scripts/vercel-build.cjs`,
  which does `prisma migrate deploy` first. Denied at the harness level. Use `npx next build`.
- **No test runner.** No Jest, no Vitest. Tests are plain `node:test` or bare `tsx` scripts, one npm
  script per area — 90 of them (`npm run test:nav`, `test:blank-upload`, `test:engineer-chat`, …).
  Run the one matching what you changed; `grep test: package.json` to find it.
- **One test file directly:** `npx tsx --test path/to/x.test.ts`. Anything importing a `server-only`
  module needs `node --conditions=react-server --import tsx path/to/x.test.ts` — that's why the
  scripts look inconsistent. Copy the invocation from the nearest existing `test:*` script.
- **`db:*` scripts point at whatever `.env.local` points at.** 7 of the 13 hardcode
  `dotenv-cli -e .env.local`, so reaching a real database is their default, not an opt-in.
  Since 2026-07-31 `.env.local` points at the Neon **scratch-dev** branch (`ep-muddy-unit`);
  **production is `ep-hidden-rice`**. Grep the host before running one — the filename tells you
  nothing, and scratch-dev is a copy-on-write clone, so it holds real users' rows: isolated, not
  anonymised. Drift repair is `npm run db:migrate:reconcile` or `prisma migrate resolve` — never
  `db push`. Use `DATABASE_URL_UNPOOLED` for `prisma migrate`; the pooler throws P1002 lock timeouts.
- Slow and costly, only when asked: `engineer:eval*` (the rebuilt harness), `setup-extract:eval`.
- iOS shell: `npm run cap:sync` / `npm run cap:open`.

Verification order before calling something done: `npx tsc --noEmit` → the matching `test:*` →
`npx next build`. There is no CI — nothing else will catch it.

## Guards you will meet

Safety lives in `.claude/settings.json` + `.claude/hooks/`, not in prose. Hooks fire below the
permission layer, so they still prompt under `bypassPermissions`. Three are wired up in
`settings.json`; `.claude/hooks/guard-test.cjs` is present but registered nowhere and does nothing.

- `prod-guard.cjs` — any production-DB or deploy-pipeline command raises a prompt.
- `kb-guard.cjs` — writes to `content/vehicle-dynamics/*.md` (top level) raise a prompt. That prose
  is quoted verbatim to paying drivers as ground truth, so edit it only when the user's latest
  message asks for it; otherwise propose the diff in chat. Drafts under
  `content/vehicle-dynamics/drafts/` are open. The `audit-kb` skill carries the real rules.
- `uncommitted-guard.cjs` — end-of-turn warning listing dirty git worktrees. Jordan runs several
  sessions in parallel, so **check `git branch --show-current` before committing**; another session
  may have moved HEAD.
- Pushing to a git remote always prompts (global hook), and `main` deploys production on push.

**Drive the app whenever it would help** (founder call, 2026-08-11, reversing the older "never drive
it" rule). Start the dev server, click through the flow, take screenshots — seeing a change actually
work beats reporting that it compiles. The `run` skill knows how to launch this project. Typecheck
and tests are still the floor, not the ceiling: if a claim can be checked in a browser, check it.
Bugs like the one that produced this line — a route that typechecks, builds, and 500s only on
Vercel — are invisible to `tsc`. Use a LAN IP listed in `allowedDevOrigins`, or the page renders and
nothing is clickable.

## Architecture

**Request path.** `src/middleware.ts` (edge, uses the Prisma-free `src/auth.config.ts`) gates
everything except `/login/*`, `/privacy`, `/terms`, `/api/health/*`, `/api/_debug/version` and
`/api/stripe/webhook` — unauthenticated APIs get 401 JSON, pages get redirected. `src/auth.ts` (Node)
holds the real NextAuth v5 config: magic-link email + optional Google, with a sign-in allowlist
(`AuthAllowedEmail` table + `AUTH_ALLOWED_EMAILS`). Pages call `requireCurrentUser()`, routes call
`getAuthenticatedApiUser()` (`src/lib/currentUser.ts`). Entitlement is always derived server-side in
`src/lib/entitlement.ts` from the Stripe webhook's `Subscription` row — never trusted from a client.

**`src/lib` is where the logic lives** (56 domain folders); `src/components` and `src/app` are
thin over it. Four subsystems carry most of the weight:

1. **Runs** — a `Run` is one 5–8 minute on-track session and the atomic unit of the whole product.
   Every run has a required `SetupSnapshot`, plus tyres, conditions, driver feel, and lap times. The
   log-run wizard (`src/components/runs/`) is the biggest surface in the app.
2. **Lap import** — `src/lib/lapUrlParsers/` scrapes LiveRC / MyRCM / MyLaps Speedhive into an
   `ImportedLapTimeSession`; `lapWatch/` polls watched URLs and pushes "new run detected" nudges.
3. **Setup sheets** — a chassis (`SetupSheetModel`) is global and shared by everyone racing that
   model; a `SetupSheetCalibration` maps one PDF layout onto its field keys. The driver fills boxes
   over a **server-rendered picture** of the page, never a client-side PDF engine. Images and
   flat/scanned PDFs are refused at the door by design. Details in the north star.
4. **The Engineer** — the LLM assistant, rebuilt ground-up 2026-08-13. `src/lib/engineer/` is
   the whole thing: KB loader, short prompt, block-based payload builder, transport
   (`DEBUG_ENGINEER_WIRE=1` dumps the real request), persist + ratings. Chat is the only
   surface; the old satellites (quick-fix, hints, dashboard suggestions) are deleted, not
   dormant. **The payload's cache-stable-prefix order is enforced in code** and every
   behaviour change lands through the eval harness first — read the north star before touching
   prompt, payload, KB, or nets.

**Materialised data.** `bestLapSeconds`/`avgTop5LapSeconds` on `Run`, the setup aggregations in
`src/lib/setupAggregations/`, and the sheet page images are all caches with their own staleness.
After a change affecting stats, rebuild via `POST /api/setup-aggregations/rebuild` or the numbers go
quietly wrong. Cache tags: `src/lib/cachedReads.ts` + `revalidateUser.ts`.

**Native deps that don't bundle.** `onnxruntime-node` (local PP-OCR), `@napi-rs/canvas`,
`pdf-to-img` and `pdfjs-dist` are in `serverExternalPackages`, and everything they load by runtime
path is listed in `outputFileTracingIncludes` in `next.config.mjs`. Two production outages so far
came from a file the tracer couldn't see — if a PDF route works locally and 500s or returns nothing
on Vercel, check the trace before anything else.

## Read the north star before you build

`docs/` holds 34 spec documents that are the product source of truth. Find the one that matches and
read it first; if nothing matches, you don't need one. A spec is intent, not shipped code —
`docs/NOT_YET_BUILT.md` says what isn't real yet, and no feature is real because a doc describes it.

| Task touches | Read |
|---|---|
| Any `.tsx` — styling, layout, visual rework | `docs/VISUAL_NORTH_STAR.md` |
| Engineer — anything: prompts, payload, KB, nets, evals, chat UX | `docs/ENGINEER_NORTH_STAR.md` (rewritten 2026-08-13; the old quality/iteration docs are deleted) |
| Setup sheet upload, import, OCR, calibration | `docs/SETUP_UPLOAD_NORTH_STAR.md` |
| What to build next / is this in scope | `docs/PRODUCT_NORTH_STAR.md` |
| Dashboard | `docs/DASHBOARD_NORTH_STAR.md` |
| Who can see or create what (access tiers, IDOR) | `docs/ASSET_ACCESS_NORTH_STAR.md` |
| Handling/rating capture on the run form | `docs/HANDLING_CAPTURE_NORTH_STAR.md` |
| First-run experience, empty states | `docs/ONBOARDING_NORTH_STAR.md` |
| Roll centre calculator | `docs/ROLL_CENTER_NORTH_STAR.md` |
| Video analysis, traces, sector compare | `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md`, `docs/VIDEO_TRACE_NORTH_STAR.md`, `docs/SECTOR_COMPARE_NORTH_STAR.md` |
| PWA, service worker, push | `docs/PWA_NORTH_STAR.md` |
| iOS shell, TestFlight, native push | `docs/TESTFLIGHT.md` |
| Billing, pricing, the paid door | `docs/MONETISATION_NORTH_STAR.md` |
| Writing KB drafts | `docs/VEHICLE_DYNAMICS_PHYSICS_KB_ROADMAP.md` |

## Conventions that aren't guessable

- **UI primitives already exist** — `SurfaceCard`, `CardPanel`, `HeroPanel`, `PagedCard`,
  `panel.tsx` (`PanelTitle`, `PanelSubtitle`, `HubRowTitle`, `Eyebrow`, `StatStrip`, `StatTile`),
  `Button`/`ButtonLink`. Check `src/components/ui/` before writing a new one. Use semantic tokens
  (`bg-background`, `text-primary`), never new raw hex. Yellow = actions only; green/red = pace and
  quality deltas only (volume deltas are neutral). Everything must work at 390px with the bottom
  dock visible, in both dark and light mode.
- **Delta sign convention:** lap deltas are `cell − anchor`, so **positive = slower**. Pace vs field
  is user − field, so **negative = faster than the field**.
- **Canonical units:** lap times in seconds, temperatures °C, wind km/h, geometry mm and degrees,
  damper oil cSt, spring rate gf/mm.
- **Three timestamps on a Run, deliberately not collapsed:** `createdAt` (row written),
  `sessionCompletedAt` (when the car was actually on track, from timing import, UTC), and `sortAt`
  (stamped once at create, the stable ordering axis so re-imports never reshuffle a day).
- `allowedDevOrigins` in `next.config.mjs` pins LAN IPs. An unlisted origin serves pages that render
  but silently fail hydration — they look fine and nothing is clickable.
- Field names ending `Iso` are UTC machine timestamps; never show them to a user unconverted.
- Files sometimes come back double-encoded (UTF-8 mojibake) and feed garbage into the Engineer
  context. Grep for it before committing prose changes.
- `next dev` has served stale CSS through repeated restarts. Verify a `globals.css` change against
  `npx next build`, not the dev server.
