# CLAUDE.md

RC car race-engineering app for competitive 1/10-scale radio-control racing: log every on-track run,
import lap times from public timing sites, read setup sheets out of manufacturer PDFs, and ask an
LLM "Engineer" what to change next. Next.js 16 App Router + React 19 + Prisma/Postgres (Neon),
deployed on Vercel (`syd1`), also shipped as a PWA and iOS/Android Capacitor shells. Solo-founder
product, live with paying users, so a production mistake reaches real drivers.

If a line here disagrees with the code, the code is right; fix the line.

## Commands

```
npx tsc --noEmit          # typecheck, the first gate
npm run lint              # eslint
npm run dev               # dev server
npx next build            # local production build
```

- `npm run build` is the Vercel pipeline, not a local build: it migrates the database first. It is
  blocked; use `npx next build`.
- No test runner. Each area has its own `test:*` npm script (`grep test: package.json`); run the one
  matching what you changed. One file: `npx tsx --test path/to/x.test.ts`, or
  `node --conditions=react-server --import tsx path/to/x.test.ts` when it imports a `server-only`
  module. Copy the invocation from the nearest existing script.
- `db:*` scripts hit whatever `.env.local` points at. Today that is the scratch-dev copy
  (`ep-muddy-unit`); production is `ep-hidden-rice`. Check the host before running one.
  More in `.claude/rules/database.md`.
- Slow and costly, run only when asked: `engineer:eval*`, `setup-extract:eval`.
- Pushing `main` or `beta` deploys. Use the `deploy` skill's checklist first.

Before calling work done: `npx tsc --noEmit` → the matching `test:*` → `npx next build`, then drive
the app if the change can be seen. There is no CI; nothing else will catch a miss.

## Nothing gets lost

A round of Engineer rulings once sat uncommitted in a side worktree for two weeks and never reached
production. So:
- Engineer, KB and nets work happens in the main folder only. Side worktrees are for risky UI or
  video experiments. If you must build elsewhere, your last message says plainly "this is NOT in
  main", and your memory note names the folder and branch.
- Commit your own work the same day: `git add <your files>`, never a sweep of other sessions' files.
- Jordan runs several sessions in this folder at once. Run `git branch --show-current` right before
  committing, because another session may have moved it. Never `git stash`, checkout or reset files
  in the main folder: that pulls other sessions' unsaved work out from under them.
- Commit and deploy status in memory notes goes stale. Check git before repeating it.

## Guards

Safety is enforced by `.claude/settings.json` and `.claude/hooks/`, not by this file. Hooks fire even
under `bypassPermissions`.
- `prod-guard.cjs` blocks production-database writes and the deploy pipeline. One exception: plain
  `npm run db:migrate:deploy` runs when `.env.local` points at scratch-dev.
- `kb-guard.cjs` asks before any write to `content/vehicle-dynamics/*.md` (top level). That text is
  quoted to paying drivers as fact, so edit it only when Jordan's latest message asks for it;
  otherwise propose the change in chat. `drafts/` is open. The `audit-kb` skill has the rules.
- `uncommitted-guard.cjs` warns at the end of a turn about uncommitted work in any worktree.
- Every `git push` asks first, and pushing `main` deploys production.
- After changing a hook, run `node .claude/hooks/guard-test.cjs`, which checks each guard against
  its test cases.

## Drive the app

If a claim can be checked in a browser, check it: start the dev server, click through the flow,
take screenshots. Typecheck and tests are the floor, not proof; some bugs only show in a real
browser, like a route that builds cleanly and 500s on Vercel. The `run` skill launches this project.
Use a LAN IP listed in `allowedDevOrigins` (`next.config.mjs`): an unlisted origin renders pages
where nothing is clickable.

Jordan often uses the same dev server. Every `src/` save and every build reloads his page and wipes
what he hasn't saved, so batch your edits and tell him before a build.

## Architecture

- **Request path.** `src/middleware.ts` (edge) gates everything except `/login/*`, `/privacy`,
  `/terms`, `/api/health/*` and `/api/stripe/webhook`. Pages call `requireCurrentUser()`, API routes
  call `getAuthenticatedApiUser()` (`src/lib/currentUser.ts`). Entitlement comes only from
  `src/lib/entitlement.ts` reading the Stripe webhook's `Subscription` row, never from the client.
- **Logic lives in `src/lib`**; `src/components` and `src/app` stay thin over it. Four subsystems
  carry most of the weight:
  1. **Runs.** A `Run` is one 5–8 minute on-track session, the atomic unit of the product. Every run
     has a required `SetupSnapshot`, plus tyres, conditions, driver feel and lap times.
  2. **Lap import.** `src/lib/lapUrlParsers/` reads LiveRC / MyRCM / MyLaps Speedhive into an
     `ImportedLapTimeSession`; `lapWatch/` polls watched URLs.
  3. **Setup sheets.** A chassis (`SetupSheetModel`) is shared by everyone racing that model. The
     driver fills boxes over a server-rendered picture of the PDF page, never a client-side PDF
     engine. Images and scanned PDFs are refused by design.
  4. **The Engineer.** `src/lib/engineer/`; its rules are in `.claude/rules/engineer.md`.
- **Caches that go stale.** `bestLapSeconds`/`avgTop5LapSeconds` on `Run`, the setup aggregations
  (`src/lib/setupAggregations/`) and the sheet page images. After a change that affects stats,
  rebuild via `POST /api/setup-aggregations/rebuild`, or the numbers go quietly wrong. Cache tags:
  `src/lib/cachedReads.ts` + `revalidateUser.ts`.
- **Native packages that don't bundle.** `onnxruntime-node`, `@napi-rs/canvas`, `pdf-to-img` and
  `pdfjs-dist` are in `serverExternalPackages`, and every file they load at runtime is listed in
  `outputFileTracingIncludes` (`next.config.mjs`). If a PDF route works locally but 500s or returns
  nothing on Vercel, check that list first; it has caused two outages.

## Specs

`docs/` holds the product specs ("north stars"). Read the matching one before building; if none
matches, you don't need one. A spec is intent, not shipped code: `docs/NOT_YET_BUILT.md` says what
isn't real yet. Lost? `docs/APP_CONTEXT.md` maps every surface, route and model.

| Task touches | Read |
|---|---|
| Any `.tsx`: styling, layout, visual rework | `docs/VISUAL_NORTH_STAR.md` |
| Engineer: prompts, payload, KB, nets, evals, chat UX | `docs/ENGINEER_NORTH_STAR.md` |
| Setup sheet upload, import, OCR, calibration | `docs/SETUP_UPLOAD_NORTH_STAR.md` |
| What to build next / is this in scope | `docs/PRODUCT_NORTH_STAR.md` |
| Dashboard | `docs/DASHBOARD_NORTH_STAR.md` |
| Who can see or create what (access tiers, IDOR) | `docs/ASSET_ACCESS_NORTH_STAR.md` |
| Handling/rating capture on the run form | `docs/HANDLING_CAPTURE_NORTH_STAR.md` |
| First-run experience, empty states | `docs/ONBOARDING_NORTH_STAR.md` |
| Roll centre calculator | `docs/ROLL_CENTER_NORTH_STAR.md` |
| Video analysis, traces, sector compare | `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md`, `docs/VIDEO_TRACE_NORTH_STAR.md`, `docs/SECTOR_COMPARE_NORTH_STAR.md` |
| PWA, service worker, push | `docs/PWA_NORTH_STAR.md` |
| Timing sweep: runs filed from the timing site, draft claims, placeholders, evening summary, arming, crons | `docs/TIMING_SWEEP_NORTH_STAR.md` |
| iOS/Android shells, TestFlight, native push | `docs/TESTFLIGHT.md` |
| Billing, pricing, the paid door | `docs/MONETISATION_NORTH_STAR.md` |
| Writing KB drafts | `docs/VEHICLE_DYNAMICS_PHYSICS_KB_ROADMAP.md` |

## Conventions

- **Deltas.** Lap deltas are `cell − anchor`, so positive = slower. Pace vs field is user − field,
  so negative = faster than the field.
- **Units.** Lap times in seconds, temperatures °C, wind km/h, geometry mm and degrees, damper oil
  cSt, spring rate gf/mm. That is how they are stored. A driver on the °F switch reads temperature
  and wind converted, so screens print them through `src/lib/units/unitSystem.ts`, never a literal °C.
- **A Run has three timestamps, kept apart on purpose.** `createdAt` (row written),
  `sessionCompletedAt` (when the car was on track, UTC, from timing import) and `sortAt` (stamped
  once at create, so re-imports never reshuffle a day).
- Field names ending `Iso` are UTC machine timestamps; convert them before a user sees them.
- Files sometimes come back double-encoded (UTF-8 mojibake: every em dash turns into three junk
  characters), which feeds garbage into the Engineer. Grep for it before committing prose.
  PowerShell `Set-Content`/`Out-File` without `-Encoding utf8` is the usual cause.
- Screens, styling and copy have their own rules in `.claude/rules/ui.md`, which load when you open
  a `.tsx` or CSS file.

## Changing these instructions

Add a rule to this file or to `.claude/rules/` only after the same mistake has happened twice. A
one-off lesson goes in a memory note instead. Anything that must never happen belongs in a hook,
because hooks are enforced and this file is only advice.
