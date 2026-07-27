# JRC Race Engineer — Project Context

**Purpose of this file.** A single self-contained briefing for an AI assistant that will never see
this codebase. It is written so that architecture, product and business questions about JRC can be
answered from this file alone. Every factual claim cites the file it came from. Where something was
not verified by reading code, it is marked **UNVERIFIED:**.

**Generated:** 2026-07-26, from the repository at `C:\Users\Jordan\rc-engineer-app` on branch
`feat/tire-catalog-touring` (HEAD `adf08b8`). Facts reflect that snapshot; the repo is under daily
active development by a solo founder, so treat "current state" claims as of that date.

**Audience assumption.** The reader knows software but knows nothing about radio-controlled car
racing. Section 11 (Glossary) defines every domain term; sections 4–6 explain the domain inline.

---

# 1. What this is

**Product in five sentences.**

1. JRC Race Engineer ("JRC", app name "JRC Engineer", domain `jrcdynamics.com`) is a mobile-first
   Next.js web app (installable as a PWA, with an iOS Capacitor shell) that replaces the paper
   notebook a competitive radio-controlled (RC) car racer keeps at the track.
2. A driver logs each **run** (one on-track session, typically 5–8 minutes) in a six-step wizard —
   which car, which tyres, what tyre prep, the current chassis setup, the lap times, and how the car
   felt — and the app links it all into one durable record (`src/components/runs/NewRunForm.tsx`,
   `src/lib/runs/wizardWalk.ts`).
3. Lap times are pulled automatically from public race-timing websites (LiveRC, MyLaps Speedhive,
   MyRCM) rather than typed by hand (`src/lib/lapUrlParsers/registry.ts`).
4. On top of that data sits **the Engineer** — a heavily prompt-engineered LLM assistant grounded in
   a founder-curated vehicle-dynamics knowledge base plus the driver's own run history, community
   setup statistics, and computed suspension geometry — which answers "what should I change next
   run and why" (`src/lib/engineerPhase5/openaiEngineer.ts`, `content/vehicle-dynamics/`).
5. Secondary systems extract setup sheets from PDFs and images via OCR + vision LLM, compute roll
   centre geometry from logged setups, and analyse onboard/trackside video into sector times.

**Who it is for.** Per `docs/PRODUCT_NORTH_STAR.md`: "Absolute beginner through world-class pro. The
product must work for a first test day and for a Worlds prep weekend." Three audiences — solo
drivers (pattern recognition across runs), teams (teammates learn from each other's working setups;
collating data across drivers at a big meeting is called out as possibly *higher* value than solo),
and — explicitly not — anyone wanting a social network, a timing-system replacement, or generic AI
chat without run context (same doc, "Non-goals").

**The problem it solves.** RC racers currently keep setup and session knowledge in paper notebooks,
spreadsheets, PDFs and group chats. Nothing connects "what I changed" to "what the car did" to "what
the lap times said". The stated north star is: *"Replace the race notebook — help every RC driver log
every run with almost no effort, review what worked, and get trustworthy setup guidance so they learn
faster lap by lap."* (`docs/PRODUCT_NORTH_STAR.md`). The intended moat is accumulated context:
"Losing the app should feel like losing a notebook."

**Current stage: private beta / solo-founder dogfood, deployed to production.**

- Deployed on Vercel (`.vercel/project.json` → project `rc-engineer-app`; `vercel.json` pins region
  `syd1`, i.e. Sydney) against a Neon Postgres database.
- Access is **allowlist-only**: sign-in requires the email to be in `AuthAllowedEmail` or the
  `AUTH_ALLOWED_EMAILS` env var (`src/auth.ts` `signIn` callback → `src/lib/authAllowlist.ts`).
  There is no open signup path enabled by default, though an access-code redemption route exists
  (`src/app/api/auth/redeem-access-code/route.ts`).
- `AGENTS.md` describes it as: *"Solo-founder app; Jordan tests it himself."*
- Billing exists in code but is **dark**: `BILLING_ENFORCED` must be exactly `"1"` to enforce; when
  unset every authenticated user resolves to full Pro access (`src/lib/entitlementLogic.ts`
  `isBillingEnforced`). Stripe price ids are unset in `.env.example`.
- Maturity signals: 71 Prisma migrations (`prisma/migrations/`, first `20260402120000_init_postgres`,
  latest `20260725120000_enrich_tiretype`), ~77,000 lines across 1,160 files in `src/`, 124 test
  files, 53 `test:*` npm scripts.

**Naming note.** "JRC" is the brand; the repo/package name is `rc-engineer` (`package.json`); the
Capacitor bundle id is `com.rcengineer.app` (`docs/TESTFLIGHT.md`). "Engineer Phase 5"
(`src/lib/engineerPhase5/`) is an internal historical name for the current Engineer implementation,
not a product-facing term.

---

# 2. Stack & tooling

| Layer | Choice | Evidence |
|---|---|---|
| Framework | **Next.js 16.2.10**, App Router, React Server Components | `package.json`, `AGENTS.md` |
| UI runtime | **React 19.2.7** / react-dom 19.2.7 | `package.json` |
| Language | **TypeScript** (strict), path alias `@/*` → `src/*` | `tsconfig.json`, `AGENTS.md` |
| Package manager | **npm** (`package-lock.json` present, 428 KB; no pnpm/yarn lockfile) | repo root |
| ORM / DB | **Prisma 6.19** → **PostgreSQL** (Neon in production) | `prisma/schema.prisma`, `.env.example` |
| Auth | **NextAuth / Auth.js v5 beta** (`next-auth@^5.0.0-beta.31`) + `@auth/prisma-adapter` | `src/auth.ts` |
| Styling | **Tailwind CSS v4** via `@tailwindcss/postcss`; semantic tokens in CSS custom properties | `tailwind.config.ts`, `src/app/globals.css` |
| Fonts | Sora (UI), Space Grotesk (page titles only), JetBrains Mono (data) — all via `next/font/google` | `src/app/layout.tsx` |
| Icons | **Phosphor** (`@phosphor-icons/react`) + **Lucide** (`lucide-react`) — both, deliberately | `package.json`, `next.config.mjs` |
| Hosting | **Vercel**, region `syd1`; cron via `vercel.json` | `vercel.json`, `DEPLOYMENT.md` |
| File storage | **Vercel Blob** (`@vercel/blob`); local disk `.local-uploads/` in dev | `.env.example`, `src/lib/videos/storage.ts` |
| LLM | **OpenAI** Chat Completions. Default Engineer model `gpt-5.5`; light tier `gpt-4o-mini` | `src/lib/engineerPhase5/openaiEngineer.ts` |
| Payments | **Stripe** (`stripe@^22.3.2`), webhook-driven entitlement | `src/app/api/stripe/webhook/route.ts` |
| Email | **Nodemailer** SMTP for magic links (Resend suggested) | `src/auth.ts`, `.env.example` |
| Push | **web-push** (VAPID, browser) + **Capacitor Push Notifications** (APNs, native) | `src/lib/webPush/`, `src/lib/nativePush/` |
| Native shell | **Capacitor 8** (iOS only), loads the deployed origin in a WKWebView | `capacitor.config.ts`, `docs/TESTFLIGHT.md` |
| PDF handling | `pdf-lib`, `pdf-parse`, `pdf2json`, `pdfjs-dist`, `pdf-to-img`, `react-pdf` | `package.json` |
| OCR | **onnxruntime-node** running a local PP-OCR model (`src/lib/setupCalibrations/models/`) | `next.config.mjs`, `AGENTS.md` |
| Image processing | `sharp` | `package.json` |
| HTML scraping | `cheerio` (timing-site parsers) | `package.json` |
| Markdown rendering | `react-markdown` + `remark-gfm` + `remark-breaks` (Engineer chat) | `package.json` |
| Lint | ESLint via `eslint-config-next`, two React-19 rules disabled | `eslint.config.mjs` |
| Video worker | Separate **Python** package (`video-analysis/`), OpenCV/YOLO, offline | `video-analysis/README.md` |
| Firmware | **PlatformIO / ESP32-S3** PWM logger prototype | `firmware/rc-pwm-logger/` |

### Deliberately chosen / unusual things

- **No test runner.** There is no Jest/Vitest. Tests are plain `node:test` or bare `tsx` scripts,
  each wired to its own npm script — 53 of them, e.g. `npm run test:nav`, `test:roll-center`,
  `test:video-analysis` (`package.json`). `AGENTS.md`: *"no global runner — ~45 granular `test:*`
  scripts, one per area. Run the one matching what you changed."* Some tests need
  `--conditions=react-server` because they import server-only modules.
- **`npm run build` is the Vercel pipeline, not a local build.** It runs `node scripts/vercel-build.cjs`,
  which executes `prisma migrate deploy` first. `AGENTS.md` warns: *"Never use it locally"* — use
  `npx next build` instead.
- **`prisma db push` is banned against production.** It skips `_prisma_migrations` and breaks
  Vercel's `migrate deploy` with a P3009 loop. There is a Claude Code PreToolUse hook
  (`.claude/hooks/db-push-guard.cjs`) that intercepts *any* `db push` form and forces a manual
  confirmation, because the local `.env.local` sometimes points at production.
- **The Engineer knowledge base is write-locked to AI agents.** `.claude/hooks/kb-guard.cjs` blocks
  edits to `content/vehicle-dynamics/*.md` (top level) and
  `src/lib/engineerPhase5/parameterEffects/catalog.ts` without explicit typed human approval, because
  that prose is quoted verbatim to drivers as ground truth. Drafts under
  `content/vehicle-dynamics/drafts/` are open.
- **`serverExternalPackages`** keeps `onnxruntime-node`, `@napi-rs/canvas`, `pdf-to-img` and
  `pdfjs-dist` out of the webpack bundle because they ship native `.node` binaries or resolve assets
  by runtime path (`next.config.mjs`).
- **`allowedDevOrigins` is pinned to two LAN IPs** (`192.168.1.112`, `192.168.50.248`). An unlisted
  origin serves pages that render but silently fail hydration — a documented footgun (`AGENTS.md`).
- **Zoom is locked app-wide** (`maximumScale: 1`, `userScalable: false`, plus a `gesturestart`
  preventDefault guard because Safari ignores `user-scalable`) — a founder decision dated 2026-07-14
  (`src/app/layout.tsx`).
- **No `README.md` at repo root.** `AGENTS.md` is the entry document; `CLAUDE.md` is a three-line
  `@AGENTS.md` import shim.

### CI

There is **no CI configuration in the repo** (no `.github/workflows`, no CircleCI/GitLab config).
Verification is manual and prescribed by `AGENTS.md`: `npx tsc --noEmit` → the matching `test:*`
script → `npx next build`. Vercel builds on push and runs migrations as part of `npm run build`.

### Environment variables (from `.env.example`)

Required in production: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_ALLOWED_EMAILS`,
`BLOB_READ_WRITE_TOKEN`. Optional/feature: `AUTH_ADMIN_EMAILS` (admin gate),
`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `EMAIL_SERVER`/`EMAIL_FROM`, `OPENAI_API_KEY`,
`ENGINEER_MODEL` / `ENGINEER_LIGHT_MODEL` / `ENGINEER_DEEP_MODEL` / `ENGINEER_JUDGE_MODEL`,
`ENGINEER_FULL_KB_IN_CONTEXT` (kill switch), `ENGINEER_FULL_KB_CONTEXT_MAX_CHARS`,
`CRON_SECRET`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_SUBJECT`,
`MYLAPS_OAUTH_*`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_{STANDARD,PRO}_{MONTHLY,ANNUAL}`,
`BILLING_ENFORCED`, `NEXT_PUBLIC_APP_URL`, `CAPACITOR_SERVER_URL`, `AI_DAILY_CALL_LIMIT` /
`AI_DAILY_COST_LIMIT_USD` / `AI_MONTHLY_COST_LIMIT_USD` / `AI_USAGE_TIME_ZONE`,
`AUTH_DEV_ALLOW_ANY_EMAIL` (non-prod only), several `DEBUG_*` flags.

---

# 3. Repo map

Top level:

```
rc-engineer-app/
├─ AGENTS.md                  ← ENTRY DOC. Single source of truth for all AI agents; CLAUDE.md imports it
├─ CLAUDE.md                  ← 3-line shim: "@AGENTS.md"
├─ DEPLOYMENT.md              ← Vercel setup, env var table, Google OAuth walkthrough
├─ PERF_BASELINE.md / PERF_RESULTS.md  ← performance measurement records
├─ package.json               ← 53 test:* scripts, eval/bench scripts, db:* scripts
├─ next.config.mjs            ← serverExternalPackages, allowedDevOrigins, tracing includes
├─ tailwind.config.ts         ← semantic colour tokens mapped to CSS vars; Sora/JetBrains fontFamily
├─ vercel.json                ← region syd1; cron */5 * * * * → /api/cron/watch-results
├─ capacitor.config.ts        ← iOS shell config (bundle com.rcengineer.app)
├─ .env.example               ← 121-line annotated env reference
├─ prisma/                    ← schema + 71 migrations + seed
├─ src/                       ← the app (see below)
├─ content/vehicle-dynamics/  ← the Engineer knowledge base (founder-approved prose, WRITE-LOCKED)
├─ docs/                      ← 30 "north star" specs + changelogs (product source of truth)
├─ scripts/                   ← eval harnesses, backfills, dedupers, seeders
├─ seeds/                     ← tires_touring.json (149 touring tyre rows)
├─ video-analysis/            ← standalone Python worker (OpenCV/YOLO sector timing)
├─ firmware/rc-pwm-logger/    ← ESP32-S3 PlatformIO firmware (steering/throttle PWM logger)
├─ hardware/rc-pwm-carrier/   ← KiCad PCB for the above
├─ ios/                       ← Capacitor iOS project
├─ public/                    ← brand marks, icons, sw.js service worker, track-hero.jpg
├─ .claude/                   ← agent rules + PreToolUse guard hooks
└─ .cursor/rules/             ← Cursor-flavoured mirrors of the same rules
```

## `src/` — entry points marked ⭐

```
src/
├─ ⭐ middleware.ts        Auth gate. Allows /login/*, /privacy, /terms, /api/health/*,
│                          /api/_debug/version, /api/stripe/webhook; everything else needs a session.
│                          Unauthenticated API → 401 JSON; unauthenticated page → /login?from=…
├─ ⭐ auth.ts              NextAuth config (Node runtime). Google OAuth (optional) + Nodemailer
│                          magic link. signIn callback enforces the email allowlist. jwt callback
│                          backfills the avatar from DB when the token's `picture` is falsy.
├─    auth.config.ts       Edge-safe subset used by middleware (no Prisma).
├─    types/next-auth.d.ts Adds `user.id` to Session and `id` to JWT.
│
├─ app/                    Next.js App Router — 61 pages, 171 API routes
│  ├─ ⭐ layout.tsx        Root layout: fonts, page-bg photo wash, PWA splash, zoom guards,
│  │                       timezone cookie bootstrap, AuthSessionProvider, AppShell, Capacitor bridges
│  ├─ ⭐ page.tsx          Dashboard (`/`) — loads cached dashboard model + onboarding view
│  ├─    globals.css       1,189 lines: design tokens (:root), page chrome classes, glass surfaces
│  ├─    manifest.ts       PWA web app manifest (served at /manifest.webmanifest)
│  ├─    loading.tsx       Root suspense skeleton
│  │
│  ├─ runs/new/            ⭐ Log-run wizard host (pillar #1 surface)
│  ├─ runs/history/        "Sessions" — the run list; run detail lives in an expanded row here
│  ├─ runs/[id]/edit/      Edit an existing run (same wizard)
│  ├─ engineer/            ⭐ Engineer chat page
│  ├─ analysis/            Debrief hub: session trend, recent-runs accordion, video + compare doors
│  ├─ analysis/roll-center/ Roll-centre "Lab" (geometry calculator)
│  ├─ assets/              Hub page listing My assets / Global assets
│  ├─ cars/, cars/[carId]/ Cars and their setups; `cars/[carId]/grip-archetypes`
│  ├─ tracks/, tracks/[trackId]/  Track catalog + detail (layouts, GPS, timing URLs, camera profiles)
│  ├─ tires/, additives/   Global product catalogs (compounds, tyre additives)
│  ├─ tire-sets/           The user's own physical tyre sets
│  ├─ events/              Race meetings / practice days
│  ├─ teams/               Team creation + membership
│  ├─ setup/               Setup pipeline hub (redirects to /cars), bulk import, comparison, admin
│  ├─ setup-documents/     Uploaded setup sheets; per-doc calibrate-image editor
│  ├─ setup-calibrations/  PDF→field mapping profiles
│  ├─ setup-sheet-models/  Chassis types + schema editor + kit setup
│  ├─ videos/              Video library, analysis jobs, manual analysis, legacy overlay
│  ├─ laps/import/         Lap-time import surface
│  ├─ settings/            Profile, timing identity, notifications, allowlist admin, Engineer feedback
│  ├─ billing/             Stripe plan picker
│  ├─ admin/review/        Founder review queue for unverified catalog rows (in-flight, uncommitted)
│  ├─ login/, login/verify-request/, privacy/, terms/   Public/unauthenticated
│  ├─ welcome/             STUB — redirects to `/` (wizard retired 2026-07-22)
│  ├─ garage/              Redirect to /assets (legacy)
│  ├─ debug/               Dev-only previews on stubbed endpoints
│  └─ api/                 171 route handlers — see §6 for the meaningful ones
│
├─ components/             ~322 .tsx files in 29 folders
│  ├─ runs/       20,206 LOC — the biggest. NewRunForm.tsx alone is 5,465 lines
│  ├─ setup-documents/  8,248 LOC — calibration editors, region drawing, review screens
│  ├─ videoAnalysis/    5,187 LOC
│  ├─ setup/            4,611 LOC
│  ├─ engineer/         3,123 LOC — EngineerPageClient, EngineerChatPanel
│  ├─ dashboard/        2,327 LOC — DashboardHome, day-verdict card, next-outing card
│  ├─ ui/               2,280 LOC — the shared primitive vocabulary (see §7)
│  ├─ layout/           2,138 LOC — AppShell, BottomNav, navConfig, AccountMenu
│  └─ … tracks, tires, additives, events, cars, assets, settings, pwa, capacitor, brand, admin,
│       billing, onboarding, providers, analysis, rollCenter, setup-sheet, setup-sheet-models,
│       betweenRunHints, laps, videos
│
└─ lib/                    47 domain folders + ~70 top-level modules — "the real logic" (AGENTS.md
                           says 42; it has grown since)
   ├─ engineerPhase5/     23,059 LOC / 142 files — THE ENGINEER. See §6.4
   ├─ setupCalibrations/   6,286 LOC — PDF field mapping, fingerprinting, auto-pick, local OCR
   ├─ setupSheetModels/    6,285 LOC — chassis-type schemas, layout editor ops, universal params
   ├─ setupDocuments/      3,780 LOC — upload, parse, rasterise, storage
   ├─ runs/                3,514 LOC — wizard walk, tyre prep, car swap, history filters
   ├─ lapWatch/            2,800 LOC — poll timing sites, push "new run" nudges
   ├─ setup/               2,750 LOC — snapshot resolution, fill order, derived fields
   ├─ lapUrlParsers/       2,421 LOC — LiveRC / MyRCM / Speedhive HTML+JSON parsers
   ├─ engineerFeedback/    2,386 LOC — ratings, gold set, judge, failure taxonomy
   ├─ setupExtractAi/      2,265 LOC — vision-LLM sheet extraction
   ├─ lapImport/           1,957 LOC — import service, outlier exclusion, driver matching
   ├─ manualVideoAnalysis/ 1,901 LOC — frame marks, transponder sync
   ├─ setupAggregations/   1,859 LOC — materialised per-car + community stats
   ├─ speedhive/           1,674 LOC — MyLaps Speedhive discovery + parsing
   ├─ setupCompare/        1,484 LOC
   ├─ rollCenter/          1,199 LOC — kinematics engine, platform packs, VSUSP import
   ├─ videoAnalysis/       1,038 LOC — worker JSON contract, sector stats, lap compare
   └─ … eventLapDetection, weather, analysis, assets, setupCalculations, tires, events, mylaps,
        aiUsage, petitrc, nativePush, eventLapDiscovery, location, cars, tracks, lapSession,
        webPush, lapImageExtract, http, rcPwmLogger, onboarding, profileImage, lapField, auth,
        additives, setupComparison, videos, account, legal, pwa
```

### Individually important `src/lib` files

| File | Job |
|---|---|
| `src/lib/prisma.ts` | Prisma singleton with a startup assertion that the `actionItem` delegate exists (catches a stale generated client with a helpful Windows-EPERM message) |
| `src/lib/currentUser.ts` | `requireCurrentUser()` (pages) / `getAuthenticatedApiUser()` (routes) |
| `src/lib/authAdmin.ts` → `authAdminLogic.ts` | Admin gate from `AUTH_ADMIN_EMAILS` |
| `src/lib/authAllowlist.ts` | Sign-in allowlist check (env + `AuthAllowedEmail` table) |
| `src/lib/entitlementLogic.ts` / `entitlement.ts` | Pure tier logic / DB-backed resolver (paywall) |
| `src/lib/dashboardServer.ts` (1,012 LOC) | Assembles the whole dashboard model in one pass |
| `src/lib/runHandlingAssessment.ts` (1,192 LOC) | The handling-feel capture model, v1→v6 migration on read |
| `src/lib/lapAnalysis.ts` (557 LOC) | All lap maths: best, avg-top-N, consistency, mistakes, deltas |
| `src/lib/trackConditionSignature.ts` | Encodes the aggregation bucket key from grip + layout + temp band |
| `src/lib/cachedReads.ts` | Next `unstable_cache` wrappers, user-scoped tags |
| `src/lib/revalidateUser.ts` | Cache-tag invalidation after mutations |
| `src/lib/apiRateLimit.ts` | In-memory burst brake (explicitly NOT the real cap — see `aiUsage/budgets.ts`) |
| `src/components/layout/navConfig.ts` | Nav ids, active-tab resolution, FAB suppression rules, `ASSETS_HUB_SECTIONS` |

---

# 4. Data model

Source: `prisma/schema.prisma` (1,616 lines, PostgreSQL). **51 models, 12 enums.** All ids are
`cuid()` strings unless stated. The schema is unusually well commented — most of the "what this means
in the real world" text below is quoted or paraphrased from those comments.

## 4.1 Domain primer (read this first)

- A **car** is a physical 1/10-scale radio-controlled racing car. In this app it belongs to one user.
- A **chassis** (`SetupSheetModel`) is the *model* of car — e.g. "Awesomatix A800RR", "Mugen MTC3".
  Chassis are global and shared: everyone with that model shares one parameter schema.
- A **setup** is the current adjustment state of a car: spring rates, damper oil viscosity, shim
  stacks, toe/camber angles, ride height, differential oil, and ~100 more values. Manufacturers
  publish these as a one-page PDF "setup sheet".
- A **run** is one on-track session — the driver puts the car on the track, drives for 5–8 minutes,
  and comes back in. This is the atomic unit of the app. **A "session" in RC racing terms == a Run
  row.** (Note: the Prisma model literally named `Session` is the NextAuth database session, an
  unrelated auth concept.)
- **Tyres** are consumable; a `TireSet` is one physical set of four tyres mounted on wheels, and its
  performance degrades with each run, so run count on the set is a first-class signal.
- **Lap times** come from a transponder in the car read by a track timing loop; results are published
  on LiveRC / MyLaps Speedhive / MyRCM websites.

## 4.2 Identity, access & billing

**`User`** — `id`, `name?`, `email?` (unique), `emailVerified?`, `image?`, `stripeCustomerId?`
(unique), timestamps. Owns essentially everything via cascade relations (cars, runs, tracks,
tireSets, batteries, snapshots, events, setup documents, calibrations, push devices, chat threads,
AI usage rows…).

**`Account`, `Session`, `VerificationToken`** — standard Auth.js adapter tables. Schema comment on
`Session`: *"kept for adapter compatibility; app uses JWT sessions in middleware."*

**`AuthAllowedEmail`** — `email` (unique). *"Emails allowed to receive magic-link sign-in (invite
list)."* This is the beta gate.

**`Subscription`** — one row per user (`userId` unique). `stripeSubscriptionId` (unique),
`stripeCustomerId`, `status` (raw Stripe status string), `tier` ("standard" | "pro"), `priceId?`,
`currentPeriodEnd?`, `cancelAtPeriodEnd`, `seats` (default 1). Schema comment: *"the webhook
(`/api/stripe/webhook`) is the source of truth… Entitlement is DERIVED server-side in
`src/lib/entitlement.ts` — never trust the client."*

**`StripeWebhookEvent`** — `id` (the Stripe event id, PK), `type`, `receivedAt`. Idempotency ledger:
each event id is claimed once so retries don't reprocess.

**`AiUsageDaily`** — `(userId, day, feature)` unique. `day` is a `@db.Date` in a **fixed** app time
zone (default `Australia/Sydney`), not UTC and not the viewer's zone. Counters: `calls`,
`promptTokens`, `completionTokens`, `costUsd`. Schema comment explains *why* it exists: the in-memory
rate limiter's real ceiling on Vercel is `limit × instance count`, i.e. none — this table is the
durable cap. `feature` ∈ `engineer-chat` | `engineer-quick-fix` | `setup-extract`.

**`Team`** — `name`, `createdByUserId?`. *"Named group for mutual visibility pilot (members share runs
in Engineer + team Sessions view)."*
**`TeamMembership`** — `(teamId, userId)` unique, `role` default `"member"` (`admin` | `member`;
schema notes the pilot uses `member` for everyone unless promoted directly in the DB).

**`TeammateLink`** — `(userId, peerUserId)` unique. **One-way**: *"Viewer (`userId`) may browse peer
runs in Engineer when same track."* Distinct from Team membership, which is mutual.

**`ChassisTypeRequest`** — `(userId, normalizedName)` unique, `requestedName`, `requestCount`,
`resolvedAt?`. Exists because chassis creation is admin-only, so *"without this the request
evaporated into a 403 and the founder never heard about it."*

## 4.3 Garage (per-user assets)

**`Car`** — `name`, `chassis?` (free text), `carClass?`, `notes?`, `setupSheetTemplate?` (legacy
string like `awesomatix_a800rr`), `setupSheetModelId?`. Owned by one user (cascade delete).
⚠️ **Schema/code drift:** the `carClass` doc comment says it drives the log-run car-swap rule, but
`src/lib/cars/carClasses.ts` states the field was dropped from the UI on 2026-07-22, nothing reads it,
and platform is now inferred from the chassis via `platformForChassisSlug`. The column is *"dormant
and unread."*

**`TireSet`** — one physical set of four tyres. `label` (denormalised display), `setNumber` (internal
per-compound counter, *"never shown as identity"*), `initialRunCount` (runs done before logging
began), `insertLabel?` (foam insert), `wheelLabel?`, `specificModel?`, `mark?`, `notes?`,
`archivedAt?` (soft delete so run history survives), `tireTypeId?`.
- **`mark`** is the physical code the driver writes on the sidewall — ≤4 chars, free text, *not*
  unique, repeats freely across compounds (`src/lib/tires/tireMark.ts`). `suggestTireMark()` returns
  the **lowest free positive integer** so numbers recycle and drivers stay in single digits rather
  than reaching "set 35".

**`Battery`** — `label`, `packNumber`, `initialRunCount`, `archivedAt?`. Mirrors TireSet.
⚠️ Per `docs/ONBOARDING_NORTH_STAR.md`: *"Batteries were removed app-wide and have no UI."* The model
and the `Run.batteryId` relation still exist.

**`SetupSnapshot`** — the actual setup values. `data` is a free-form `Json` blob keyed by the sheet
model's field keys. `name?` and `isLibrary` distinguish two kinds:
- **per-run snapshots** (name null, `isLibrary` false) — every logged run creates one; anonymous history.
- **library setups** (`isLibrary` true) — named reusable setups on the car page ("X4 — high grip carpet").
  Schema comment: *"Aggregations read snapshots through runs, so library rows can never enter the
  community pool."*
Also carries `baseSetupSnapshotId?` + `setupDeltaJson?` (audit of what was merged), and
`renderedSetupPdfPath?` / `setupPdfRenderVersion` for the generated filled PDF.

## 4.4 Venue & calendar

**`Track`** — `name`, `location?`, `latitude?`/`longitude?`/`locationMarkedAt?`/`locationSource?`
(GPS pin from "mark this location" at run completion), `liveRcUrl?`, `speedhiveUrl?` (timing-site
roots for session discovery), `gripTags[]`, `layoutTags[]`, `verifiedAt?`. Global catalog: created by
any user, usable by everyone, flagged unverified until the founder approves.

**`TrackLayout`** — a named physical configuration of a track ("Club layout", "Nats config"). Schema
comment is explicit: *"Descriptive only — layouts do NOT change community-aggregation /
condition-scope buckets."* Direction (CW/CCW) is chosen per run/event, not stored on the layout.

**`FavouriteTrack`** — `(userId, trackId)`.
**`TrackLocationRunPromptDismissal`** — `(userId, trackId)`: don't show the GPS modal again here.

**`Event`** — a race meeting or practice day. `name`, `startDate`, `endDate`, `trackId?`,
`trackLayoutId?`, `trackDirection?`, plus snapshot columns (`trackNameSnapshot`,
`trackLocationSnapshot`, `trackLayoutNameSnapshot`, `legacyTrackJson`) that preserve venue identity
if the Track row is deleted. Timing integration: `practiceSourceUrl?`, `resultsSourceUrl?`,
`raceClass?`, and two watermarks (`practiceLastSeenSessionCompletedAt`,
`resultsLastSeenSessionCompletedAt`) for incremental auto-import. Events are **global per
track/meeting**, not per user. A deferred unique constraint on `(trackId, resultsSourceUrl)` is noted
in the schema but not yet applied (see §9).

**`EventParticipation`** — `(userId, eventId)` unique. Per-user link to a global event: `notes?`,
`controlledTireTypeId?` / `controlledTireLabel?` (the spec tyre a meeting mandates),
`controlledAdditiveTypeId?`, `pinnedAt?` (prefer this event on the dashboard).

## 4.5 Global product catalogs

**`TireType`** — a tyre *product* (compound), e.g. "Sweep D32". `displayName`, `modelCode` (unique —
the canonical identity), `verifiedAt?`, `createdByUserId?`. Newly added (uncommitted migration
`20260725120000_enrich_tiretype`, all nullable): `discipline`, `brand`, `model`, `compound`,
`surface` (`asphalt` | `carpet` | `both` | `unknown`), `tireType` (`rubber` | `foam`), `sourceUrl`,
`productUrl` — attributes for the AI catalog pre-seed programme.

**`AdditiveType`** — a tyre-additive product ("tyre sauce"), e.g. "Mighty Gripper — Yellow". Same
shape: `displayName`, `modelCode` unique, `verifiedAt?`.

**`SetupSheetModel`** — **the chassis type**. `name`, `slug` (unique, e.g. `mugen_mtc3`,
`awesomatix_a800rr`), `schemaJson` (the parameter schema — see §4.9), `isAuthorized` (this model's
version of "verified"; admin-curated), `kitSetupJson?` (the manufacturer's baseline setup),
`defaultCalibrationId?`. Global, not user-owned — `userId` is creator attribution only.

**`SetupSheetCatalogSuppression`** — `slug` PK. Catalog slugs an admin deleted, so the global seed
does not recreate them.

**`SetupSheetManufacturerBaseline`** — `setupSheetTemplate` PK, `pdfUrl`, `summary?`, `reviewedAt?`.
The official kit PDF for a template; deliberately **not** counted in community sample statistics.

## 4.6 The Run (the central table)

**`Run`** — one on-track session. ~70 columns. Grouped by concern:

*Identity & context*
- `sessionType` enum `SessionType`: `TESTING` | `PRACTICE` | `RACE_MEETING`.
- `meetingSessionType?` string: `PRACTICE` | `SEEDING` | `QUALIFYING` | `RACE` — only when
  `sessionType = RACE_MEETING`.
- `meetingSessionCode?`: e.g. `"1"`,`"2"` for practice/race legs; `"Q1"`,`"Q2"` for qualifiers.
- `sessionLabel?`: free text.
- `carId?`, `trackId?`, `trackLayoutId?`, `trackDirection?` (`CW`|`CCW`), `eventId?`, `raceClass?`.
- `carNameSnapshot?`, `trackNameSnapshot?`, `trackLayoutNameSnapshot?` — survive parent deletion.

*Equipment*
- `tireSetId?`, `tireRunNumber` (auto-increments per tyre set), `additiveTypeId?`,
  `batteryId?`, `batteryRunNumber`.
- `tirePrep` Json — ordered prep steps (§5.5). `warmerTimingMinutes?` Int is the **legacy** single
  value, kept in sync as a derived total (sum of warmer-step minutes).

*Setup*
- `setupSnapshotId` (**required** — every run has a setup snapshot), `sourceSetupDocumentId?`,
  `sourceSetupCalibrationId?`, `renderedSetupPdfPath?`, `setupPdfRenderVersion`.

*Laps*
- `lapTimes` Json (default `[]`) — the primary driver's lap times as a plain number array.
- `lapSession` Json? — the richer versioned blob (§4.10), kept in sync with `lapTimes[primary]`.
- `bestLapSeconds?`, `avgTop5LapSeconds?` — **materialised** at save time so list views don't
  recompute from JSON per row. Null on legacy rows → callers fall back to computing.

*Driver feedback*
- `carRating?` Int 1–10 — *"Required 1–10 overall car rating captured at 'Run complete'. Nullable in
  DB so legacy and draft runs aren't broken, but the run-complete API path enforces it."*
- `handlingAssessmentJson?` — structured feel (§5.4).
- `notes?` (unified), plus legacy `driverNotes?` / `handlingProblems?`.
- `suggestedChanges?`, `suggestedPreRun?`, `appliedChanges?` — bullet-format text feeding ActionItems.

*Time & ordering* (this is subtle — see §5.2)
- `createdAt` — when the row was saved.
- `sessionCompletedAt?` — when the session actually happened on track, from timing import.
- `loggingComplete` Bool, `loggingCompletedAt?` (immutable first-completion time),
  `incompleteLoggingPromptDismissedAt?`.
- `sortAt` — *"Stable ordering axis… stamped once at create time and never auto-updated"*, so
  "if B was completed after A, B stays above A forever" holds regardless of edits or re-imports.

*Conditions* (all nullable; canonical metric units)
- `conditionsAirTempC?`, `conditionsTrackTempC?` (**manual probe only — never from the weather API**),
  `conditionsCloudCoverPct?`, `conditionsWeatherCode?` (WMO code), `conditionsHumidityPct?`,
  `conditionsWindKph?`, `conditionsWindDirDeg?`, `conditionsSource?`
  (`open-meteo-forecast` | `open-meteo-archive` | `manual`), `conditionsLatitude?`,
  `conditionsLongitude?`, `conditionsObservedAt?`.

*Sharing & caches*
- `shareWithTeam` (default true) — when false, mutual team members don't see the run.
  **One-way `TeammateLink` visibility is unaffected.**
- `engineerSummaryJson?` + `engineerSummaryRefRunId?` + `engineerSummaryComputedAt?`,
  `engineerDeepDiveJson?`.
- `practiceDayUrl?` — the timing day-results URL this run came from, captured per run so history
  remembers.
- `importedLapTimeSessionId?` (unique) — the primary imported session when created by detection.

## 4.7 Lap-time ingestion

**`ImportedLapTimeSession`** — a parsed session from a timing URL, reusable outside one run.
`sourceUrl`, `parserId`, `sourceType` (default `timing_url`), `parsedPayload` Json (snapshot of the
parse result: laps, sessionDrivers, sessionHint), `fieldStatsJson?` (per-driver + field aggregates —
best / avgTop5 / avgTop10, median field pace, ranks — `ImportedSessionFieldStatsV1`),
`sessionCompletedAt?` (stored UTC), `linkedRunId?`, `linkedEventId?`, `eventDetectionSource?`
(practice vs race), `eventRaceClass?`, `eventDetectionSessionLabel?`, `detectionPromptDismissedAt?`.

**`RunImportedLapSet`** / **`RunImportedLap`** — persisted per-driver lap rows attached to a run.
`RunImportedLapSet` carries `driverName`, `normalizedName`, `displayName?`, `surname?`,
`isPrimaryUser`, `sourceUrl?`, `sessionCompletedAt?` (denormalised). `RunImportedLap` has
`lapNumber`, `lapTimeSeconds`, `isIncluded` (default true — the exclusion flag).

**`WatchedLapSource`** — a timing URL the app polls for this user. `targetMode` ∈ `driver` (match
parsed driver name in practice sessions) | `class` (race results index scoped by class) | `none`.
`targetClass?`, `targetDriverOverride?`, legacy `driverName?`, `carId?`, `lastCheckedAt?`,
`lastSeenSessionCompletedAt?`.

## 4.8 Setup document pipeline

**`SetupDocument`** — an uploaded setup sheet (PDF or image). Heavy state machine:
- `sourceType` enum: `PDF` | `IMAGE`.
- `parseStatus` enum: `PENDING` | `PARSED` | `PARTIAL` | `FAILED`.
- `importStatus` enum: `PENDING` | `PROCESSING` | `FAILED` | `COMPLETED` | `COMPLETED_WITH_WARNINGS`.
- `importOutcome` enum: `COMPLETED_TRUSTED` | `COMPLETED_WITH_WARNINGS` | `PARTIAL_DIAGNOSTIC` | `FAILED`.
- Stage tracking: `currentStage`, `lastCompletedStage`, `stageStartedAt`, `stageFinishedAt`,
  `importDebugLogJson`, `importDiagnosticJson`, `importErrorMessage`.
- Content: `storagePath`, `mimeType`, `originalFilename`, `extractedText?`, `parsedDataJson?`.
- Provenance: `sourceUrl?`, `sourceSite?` (e.g. `"petitrc"`), `sourceContentSha256?` (SHA-256 of the
  original bytes for dedupe). Two uniques: `(userId, sourceUrl)` and `(userId, sourceContentSha256)`.
- Calibration linkage: `calibrationProfileId?` (sticky), `parsedCalibrationProfileId?` (what actually
  produced the current parse — stale detection), plus `calibrationResolved*` audit fields.
- Dataset consent: `importDatasetReviewStatus` enum `UNSET` | `NOT_CONFIRMED` | `CONFIRMED_ACCURATE`,
  and `eligibleForAggregationDataset` — *"True only when user confirmed accurate and parse
  succeeded."* **This flag is what admits a document to the community statistics pool.**
- `createdSetupId?` → the `SetupSnapshot` it produced.

**`SetupImportBatch`** — bulk import grouping (label + files first; calibration/parse per document).

**`SetupSheetCalibration`** — the reusable mapping from a PDF/image layout to schema field keys.
`name`, `sourceType`, `calibrationDataJson` (regions and/or AcroForm field rules — §4.9),
`exampleDocumentId?`, `setupSheetModelId?`, `communityShared` (legacy), `verifiedAt?`.
Critical rule from `docs/ASSET_ACCESS_NORTH_STAR.md`: *"Anyone may create a calibration to unblock
their own uploads; auto-pick offers it to other users only once verified. A wrong calibration
silently mis-parses every reuser's setups."*

## 4.9 Schema-of-a-schema: what a chassis "sheet" is

`SetupSheetModel.schemaJson` parses to `SetupSheetModelSchema`
(`src/lib/setupSheetModels/types.ts`):

```ts
{
  version: 1,
  label: string,
  structuredSections: Array<{ id, title, rows: SetupSheetModelLayoutRow[] }>,
  fields: SetupSheetModelFieldDef[],
  layoutGroups?: Record<string, SetupSheetLayoutGroup>,
}
```

A **field** (`SetupSheetModelFieldDef`) has `key` (the snapshot storage key), `displayLabel`,
`sectionId`/`sectionTitle`, `valueType`, `uiType`, `unit?`, three visibility flags
(`showInSetupSheet`, `showInAnalysis`, `showInLogRun`), `sortOrder`, optional grouped-choice metadata
(`groupBehaviorType`, `groupedOptionLabels`, `groupedOptionValues`), and — importantly —
`universalParameterId?`.

A **layout row** is one of: `single`, `pair` (front/rear), `corner4` (FF/FR/RF/RR), `slots` (2–6
free-labelled cells — the modern shape; `pair`/`corner4` are legacy and only auto-inferred),
`screw_strip`, `top_deck_block`.

**Universal parameters** (`src/lib/setupSheetModels/universalParameters.ts`) are the cross-chassis
canonical ids that make aggregation possible across different manufacturers' sheets:
`toe_front`, `toe_rear`, `ride_height_front/rear`, `droop_front/rear` (alias `downstop_*`),
`camber_front/rear`, `spring_front/rear` (alias `spring_rate_*`), `shock_oil_front/rear` (alias
`damper_oil_*`), `arb_front/rear`, `roll_center_front/rear`. The bucket id for pooled touring data is
`universal_touring`. **If a drafted schema omits `universalParameterId` on a cross-car concept, that
car silently drops out of community aggregations** (`docs/SETUP_UPLOAD_NORTH_STAR.md` Stage 1.5).

Calibration mapping rules (`src/lib/setupCalibrations/types.ts`) cover both worlds:
- **AcroForm PDFs**: `acroField` (name + optional widget index), `singleChoiceWidgetGroup`,
  `multiSelectWidgetGroup`, `singleChoiceNamedFields`, `multiSelectNamedFields`.
- **Text PDFs**: `fixed_line_token` (page/line/token index), `anchor_token` (find a line containing
  anchor text, then take token N).
- **Images**: `CalibrationFieldRegion` — `{ page, x, y, width, height }` normalised crops.

## 4.10 Lap session blob (`Run.lapSession`)

`src/lib/lapSession/types.ts`, `LAP_SESSION_VERSION = 1`:

```ts
{
  version: 1,
  source: { kind: "manual"|"screenshot"|"url"|"csv", detail?, parserId? },
  entries: LapEntry[],
  metrics?: { bestLap, averageTop5, lapCount },
  context?: { sessionLabel?, eventId?, eventName?, sessionHeatId? },
}
```

`LapEntry.role` ∈ `primary` | `teammate` | `competitor` | `field_reference`. `perLap[]` carries
`isOutlierWarning`, `warningReason`, `isFlagged`, `flagReason`, and `isIncluded` (default true).
**`entries[0]` is always the primary driver**, and its laps are duplicated into `Run.lapTimes`.

## 4.11 Aggregations (materialised statistics)

**`SetupParameterAggregation`** — per-car stats. Unique on `(scopeType, scopeKey, carId, parameterKey)`.
- `scopeType` enum `SetupAggregationScopeType`: `CAR_PARAMETER` (all eligible snapshots for the car;
  `scopeKey = carId`) | `CAR_PARAMETER_CONDITION` (`scopeKey` = the encoded condition signature).
- `valueType` enum `SetupAggregationValueType`: `NUMERIC` | `CATEGORICAL` | `BOOLEAN` | `MULTI_SELECT`.
- `sampleCount`, `numericStatsJson?`, `categoricalStatsJson?`.

**`CommunitySetupParameterAggregation`** — app-wide stats. Unique on
`(setupSheetTemplate, trackSurface, gripLevel, parameterKey)`. `trackSurface` ∈ `asphalt` | `carpet`;
`gripLevel` ∈ `any` (always emitted) | `low` | `medium` | `high` — *"one row per grip tag the doc
claims; multi-tag docs land in multiple buckets."* Rebuilt by
`src/lib/setupAggregations/rebuildCommunityTemplateAggregations.ts`, which excludes documents that
aren't `eligibleForAggregationDataset`, have no car/template/surface, are too sparse, or are linked to
an **unverified** chassis model (`excludedUnverifiedTemplate` counter).

## 4.12 Engineer persistence

| Model | Purpose |
|---|---|
| `EngineerChatThread` | A conversation; optional `primaryRunId` / `compareRunId` anchors |
| `EngineerChatMessage` | One turn. `role`, `content` (`@db.Text`), `metadataJson?` (KB sections, run ids, source route) |
| `EngineerMessageRating` | `(messageId, userId)` unique. `stars` **0–10**, `note?`, `contextSnapshot` Json. Admin-only UI |
| `EngineerGoldSetCandidate` | Auto-captured founder Q&A queued for gold-set review. `status` ∈ pending/promoted/dismissed, `questionHash`, `reviewerJson?`, `promotedCaseId?` |
| `EngineerBetweenRunHint` | Cached proactive "next session" hints. `primaryRunId` unique, `inputFingerprint` (SHA-256 of inputs — cache key), `payloadJson` |
| `EngineerDashboardSuggestion` | Same pattern for the dashboard suggestions tab. **Currently dormant** (§6) |

## 4.13 Video

**`TrackCameraProfile`** — a fixed/fisheye camera setup for a track. `referenceImagePath?`,
`lensJson?` (OpenCV fisheye intrinsics), `lastAlignmentJson?` (last good homography).
**`TrackSectorLine`** — `(profileId, lineKey)` unique. `lineKey` is a stable id like `sf`
(start/finish) or `s1`; coordinates `x1,y1,x2,y2` are **normalised [0,1]** on the reference image.
**`VideoAsset`** — an uploaded video. `storagePath`, `bytes`, `label?`, `localAnalysisPath?` (when
analysis runs on-device and the file was never uploaded), optional `runId` / `trackId`.
**`VideoAnalysisJob`** — `status` enum `PENDING`|`RUNNING`|`COMPLETED`|`FAILED`; `analysisMode`
`worker` (Python JSON import) or `manual` (user frame marks + transponder sync); `alignmentJson?`,
`resultJson?` (`VideoAnalysisResultV1`), `idCorrectionsJson?` (manual MOT id remaps),
`manualJson?` (`ManualVideoSessionV1`).

## 4.14 Misc

**`ActionItem`** — the driver's to-do/experiment lists. `listKind` enum `ActionItemListKind`:
`THINGS_TO_TRY` | `THINGS_TO_DO`. `sourceType` enum `ActionItemSourceType`: `RUN` | `MANUAL`.
`text`, `normKey` (dedupe key), `sortOrder`, `isCompleted`, `isArchived`, `sourceRunId?`.

**`AppSetting`** — `(userId, key)` unique key/value store. Known keys include `myName`,
`liveRcDriverName`, `speedhiveTransponderNumbersJson`, `speedhiveTransponderLoanerAt`,
`currentPracticeDayUrl`, `onboardingSeenAt`, `onboardingResumeDismissedAt`,
`speedhive_result_watch_notified_urls`, `setupSheetManufacturerBaseline` settings.

**`PushSubscription`** — Web Push (browser). `endpoint` unique, `p256dh`, `auth`, `userAgent?`,
`lastNotifiedAt?`. Pruned when the endpoint returns 404/410.
**`NativePushDevice`** — APNs/FCM. `token` unique, `platform` (`ios` today), `deviceLabel?`.
Separate model because *"an APNs/FCM token is a single opaque string — there is no endpoint URL or
key pair to store, and the send path is a different transport."*

---

# 5. Domain rules & invariants

## 5.1 Units and conventions

| Quantity | Canonical unit | Notes |
|---|---|---|
| Lap time | **seconds**, float | `lapTimeSeconds`; displayed to 3 dp (`formatLapDelta` → `+0.123`) |
| Air / track temperature | **°C** | `conditionsAirTempC`, `conditionsTrackTempC` |
| Wind | **km/h**, direction in **degrees** | `conditionsWindKph`, `conditionsWindDirDeg` |
| Humidity / cloud | **percent** Int | |
| Suspension geometry | **millimetres**; angles in **degrees** | `src/lib/rollCenter/engine.ts` |
| Damper oil | **cSt** (centistokes) | `damper_oil_*`; higher = thicker |
| Spring rate | **gf/mm** | seen in prompt examples ("front spring 305 gf/mm") |
| Tyre-prep duration | **minutes** Int, capped 0–600 | `src/lib/runs/tirePrep.ts` |
| Warmer temperature | **°C** Int, wheel range 40–100, hard cap 250 | same file |
| Money | **USD** for AI cost estimates; Stripe prices quoted AUD | `aiUsage/budgets.ts`, `.env.example` |

**Roll-centre coordinate convention** (`src/lib/rollCenter/engine.ts`): *"x lateral from car centreline
(right = +), z up from ground, mm."* All geometry is a 2D front-elevation double-wishbone model.
Positive `derived_roll_center_*_mm` means above ground; **touring-car values near or below zero are
normal, not an error**. `derived_roll_axis_rake_mm` = rear RC − front RC (positive = axis rakes down
toward the front). Arm-angle rows are true inclinations with **+ = outer end higher**.

**Delta sign convention** — this trips people up and is stated repeatedly in the code:
- Lap deltas: `delta = cell − anchor`; **positive = slower**, negative = faster
  (`src/lib/lapAnalysis.ts` `getDeltaStyle`, `formatLapDelta`).
- Setup comparison: "change compare→primary means subtracting compare from primary"; for shim mm,
  positive = raised stack on primary (`openaiEngineer.ts` CHAT_SYSTEM).
- Tyre-life priors: median is `toRun − fromRun`, so **positive ⇒ slower on the later run** (normal
  drop-off).
- Pace vs field: `gapUserMinusFieldMeanSeconds` — **negative = faster than the field average**.

**Colour semantics for data** (`docs/VISUAL_NORTH_STAR.md`): green `#4FD089` = faster/better,
red `#E5644E` = slower/worse — **pace and quality deltas only**. Volume deltas (fewer runs, fewer
laps) render neutral with a plain ↑/↓. Yellow is never a data colour.

## 5.2 Time handling (a recurring source of bugs)

Three distinct timestamps on a Run, deliberately not collapsed:

1. **`createdAt`** — when the DB row was written.
2. **`sessionCompletedAt`** — when the car was actually on track, parsed from the timing site. Stored
   UTC. LiveRC/MyRCM publish wall-clock times "as if UTC", so the import path tracks a
   `sessionCompletedAtIsWallClock` flag (`src/app/api/runs/route.ts`).
3. **`sortAt`** — the stable ordering axis. Stamped once at create; only changes on an explicit user
   reorder or an opt-in "use session time". Exists so re-imports and edits can never reshuffle a
   day's run order.

Display falls back `loggingCompletedAt` → `sessionCompletedAt` → `createdAt`.

The user's timezone is carried in a cookie (`RC_TIMEZONE_COOKIE`, set pre-hydration by an inline
script in `src/app/layout.tsx`) and read server-side via `getExplicitTimeZoneForRunFormatting()`.

**Hard rule enforced in the Engineer prompt**: fields ending in `Iso` are UTC machine timestamps for
ordering only — *"never read a clock time or a calendar date out of an '*Iso' field."* The model must
quote pre-formatted label fields (`createdAtLabel`, `whenLabel`, `referenceLabel`) verbatim.

**Exception:** the AI spend ledger's `day` key uses a **fixed** zone (`Australia/Sydney` by default),
*"deliberately not the viewer's zone: a spend cap keyed on a device time zone resets early for anyone
who changes it"* (`src/lib/aiUsage/budgets.ts`).

Known open bug: `docs/USER_FEEDBACK_BACKLOG.md` FB-19 — *"Time of day / event running still seems off,
think based on utc"* — priority 2, **not started**.

## 5.3 What a valid lap / run / trace looks like

**Valid lap** (`src/lib/lapAnalysis.ts` `getIncludedLaps`): `lapNumber !== 0` **and** `isIncluded`
**and** `lapTimeSeconds` is a finite number. Lap 0 is excluded everywhere by convention — in RC
timing, lap 0 is the standing-start out-lap and is not comparable.

Derived metrics, all computed from included laps only:
- `bestLap` = min.
- `averageTopN` = mean of the fastest N (or fewer if not enough laps). The app uses **top 5** as the
  primary pace metric and top 10 as the session-strength metric.
- `consistencyScore` = **100 − CV%** clamped to [0,100], where CV = stdDev/mean × 100. Higher is more
  consistent. Rounded to 2 dp (`roundConsistencyScore`) and shown as a percentage.
- `spread` = slowest − fastest.
- **Mistake laps**: a display-only count of laps slower than the session median by more than
  `max(0.5 s, 2 × IQR)`. Requires ≥ 6 included laps (`MIN_LAPS_FOR_MISTAKES`). Does **not** change
  best/avg.

**Series equivalence**: two lap series are the same if included laps match in count, lap number order,
and each time within `LAP_SERIES_EQUIVALENCE_TOLERANCE = 0.0005 s`. Used to drop duplicate imports.

**Valid run**: must have a `setupSnapshotId` (schema-required). To be `loggingComplete`, the
run-complete API path enforces a `carRating` 1–10. A run with `loggingComplete = false` is a **draft**
and is resumable.

**Data bugs to watch for** (derived from the code's own defences):
- A run whose `bestLapSeconds` column disagrees with recomputing from `lapTimes` + `lapSession`
  exclusion flags — the materialised columns are written at save time and could drift if a writer
  skips `computePersistedRunLapSummary`.
- `lapTimes` out of sync with `lapSession.entries[0].laps` — they are meant to be duplicates.
- A `perLap` array whose length differs from `lapTimes` — `primaryLapRowsFromRun` silently falls back
  to "all included" in that case, so exclusions would be silently lost.
- Setup aggregation numbers going stale: `AGENTS.md` warns *"Setup aggregations are materialized —
  after a change that affects stats, rebuild via `POST /api/setup-aggregations/rebuild` or numbers go
  stale silently."*
- A `SetupSnapshot` with `isLibrary = true` appearing in aggregations would be a bug — library rows
  must never enter the pool.
- A tyre set with `archivedAt` set still appearing in a picker.

**Video trace validity** (`video-analysis/README.md`): footage should be **1080p60 fisheye from a fixed
mount**. The stop/go gate is `passesGate0_15` — *"median lap delta ≤ 0.15 s and ≥ 80% laps within
0.15 s"* versus transponder ground truth. Sector-line coordinates are normalised [0,1]. The worker
samples every N frames (`--sample-every 2` in the documented invocation).

**PWM logger trace** (`firmware/rc-pwm-logger/src/log_format.h`): binary log, magic `0x52435057`
("RCPW"), version 1. 12-byte `LogHeader { magic, version, record_size, sample_hz }` then packed 9-byte
`LogRecord { t_ms:u32, steering_us:u16, throttle_us:u16, flags:u8 }`. Flags bit 0 = steering stale,
bit 1 = throttle stale. Values are servo pulse widths in microseconds. **Safety invariant:** *"firmware
never generates, buffers, or re-drives servo/ESC PWM. The hardware signal path must stay passive so
control keeps working if the logger is off or crashed."*

## 5.4 Handling capture (how a driver describes what the car did)

`src/lib/runHandlingAssessment.ts` + `docs/HANDLING_CAPTURE_NORTH_STAR.md`. Persisted JSON is
**version 6**; versions 1–5 are migrated on read.

Governing principle: *"Corner balance already carries the core push / rotate / loose story. Everything
else must earn its tap by capturing something balance doesn't — and pointing at a different set of
adjustments."*

| Input | Required? | Scale |
|---|---|---|
| **Car rating** | required on completed runs | 1–10 buttons |
| **Feel vs last run** | required when a prior run exists on the car | −3/−2/0/+2/+3 (Much worse … Much better) |
| **Corner balance** | optional | per phase (`entry`/`mid`/`exit`), each **−3 (understeer) … +3 (oversteer)** |
| **Steering feel** | optional chip | −3 dull … +3 pointy — the only genuinely bipolar chip |
| **On-power** | optional chip | −3 snaps … +3 hooks up (problem pole negative) |
| **Braking** | optional chip | −3 loose … +3 stable |
| **Traction rolling** | optional chip | −3 never … +3 often (problem pole **positive**) |
| **Drivability** | optional chip | −3 on-edge … +3 easy |
| **Speed tag** | optional, per flagged issue | `slow` \| `fast` \| `both` |

Key design: **traits are "flag-if-notable" chips, not always-on sliders** — the good state is the
*absence* of a flag. Storage stays signed −3…+3 so the Engineer read is unchanged. Severity 1/2/3 maps
to mild/moderate/severe and supplies the magnitude. `feelGeneral` (smooth↔reactive) was **retired from
capture 2026-07-08**; the parser is kept only to label legacy rows.

`HandlingIssueKey` is the stable id a speed tag attaches to: `balance:entry|mid|exit`,
`trait:feelSteering|onPower|braking|tractionRoll|driveEase`.

The Engineer is instructed to read `carRating` as **bands, not points** — "very bad (1–3) / workable
(4–5) / good (6–7) / dialled (8–10)… Never hinge a recommendation on a one-point difference"
(`openaiEngineer.ts`).

## 5.5 Tyre rules

**Tyre prep** (`src/lib/runs/tirePrep.ts`) — a run has **one** additive plus an **ordered list of up to
3 prep steps**. Each step: `{ appliedAdditive: bool, minutes: number|null, warmers: bool, towels: bool,
temperatureC: number|null }`. `towels` and `temperatureC` are only meaningful when `warmers` is true and
are force-cleared otherwise. Real-world examples from the doc comment:

```
carpet:   bench 20m + bench 15m + bench 10m   (×3, no warmers)
outdoor:  bench 20m + warmers 10m @ 55°C (towels)
```

Defaults when a step is explicitly added: 20 minutes, 70 °C (founder decision 2026-07-15 —
*"a shown default IS the logged value"*). The section starts empty, so ignoring tyre prep saves
nothing. Display format: `"VP · 20m bench + 10m warmers 55°C (towels)"`.

**Tyre wear index**: `effectiveWearIndex = Run.tireRunNumber + TireSet.initialRunCount`. This is the
number the Engineer reasons about for wear; `initialRunCount` exists because a driver may start
logging on a set that already has runs on it.

**Tyre-set session chain** (`src/lib/tires/tireSetSessionChain.ts`) — a set's *earned identity* in the
picker, derived only from logged runs, never typed: e.g. `"3 runs · Q1 Q2 R"`. Per-run label priority:
`meetingSessionCode` → `sessionLabel` → short code from `meetingSessionType` (P/S/Q/R) → short date.

**Fairness invariant for pace comparison** — stated in the Engineer prompt and enforced by
`pairPacingContext`: if `sameTireWearSlot` is false **or** `tireRunDeltaPrimaryMinusCompare ≠ 0`, lap
deltas are **not** a fair setup A/B, and the model is forbidden from attributing pace to a specific
knob unless only one tuning key changed or the user confirmed a one-variable test.

## 5.6 Car-swap rule (log-run wizard)

`src/lib/cars/carClasses.ts` + `src/lib/runs/carSwap.ts`. When the driver changes the car mid-log:
- Day context (event / track / session / laps / notes) **always** carries.
- **Tyres + prep** carry only between cars on the **same chassis platform** (the same wheels bolt on).
  A cross-platform swap re-derives them from the new car's own last run.
- Setup is always car-specific and swaps regardless.
- `isSamePlatform(a, b)` returns **true when either side is null** — the deliberately safe default:
  an uncatalogued chassis keeps today's behaviour rather than silently re-deriving.

Platform ids: `touring`, `formula`, `pan-12th`, `gt`, `m-chassis`, `buggy-2wd`, `buggy-4wd`,
`stadium-truck`, `short-course`, `buggy-8th`, `truggy`, `rally`, `crawler`. Only **touring** is
actually built out today.

## 5.7 Session classification

`src/lib/runs/classifySession.ts` maps a timing-provider round name to the app's session model, by
string match only. Rules baked in from a 2026-07-16 founder interview:
- Mains carry an A–F letter; **legs collapse** — "A-Main Leg 2" → `"A Main"`.
- Bare "Main"/"Feature" → `RACE`, letter `"A"`.
- Qualifying absorbs **seeding, bump, and LCQ** — *"Seeding is intentionally not surfaced."*
- Bare "Round N" is **ambiguous** → classified `QUALIFYING` but with `confident: false`.
- **Only a `confident` classification may overwrite what the driver picked.** `applySessionClassification`
  returns the originals unchanged otherwise.

## 5.8 Condition buckets (how runs are grouped for statistics)

`src/lib/trackConditionSignature.ts`:

```
base:            g:LOW+MEDIUM_l:TECHNICAL      (or g:none_l:none when untagged)
with temp band:  g:LOW+MEDIUM_l:TECHNICAL_t:warm
```

Grip tag ids (`src/lib/trackMetaTags.ts`): `VERY_LOW`, `LOW`, `MEDIUM`, `HIGH`, `VERY_HIGH`.
Layout tag ids: `VERY_TECHNICAL`, `TECHNICAL`, `MEDIUM`, `FAST`, `VERY_FAST`. Both are multi-select and
always normalised into canonical order so the signature is stable.

Temperature bands (`src/lib/weather/temperatureBands.ts`), °C: **cool < 16 ≤ mild < 23 ≤ warm < 30 ≤ hot**.
Deliberately only 4 buckets — *"grip changes meaningfully across them, but finer buckets would fragment
already-sparse per-car run data."* The rebuild always also emits a temp-agnostic bucket, and reads
prefer the temp-specific bucket with a fallback to base.

**Invariant:** the `_t:` suffix is only appended when a band exists, so the base form stays
byte-identical to the legacy signature — existing aggregation rows keep working.

**Track layouts do not participate in bucketing** (schema comment on `TrackLayout`), despite layout
*tags* doing so. Layout tags live on the Track; the named layout is descriptive only.

## 5.9 Statistical trust rules (encoded in the Engineer prompt)

These are unusual and worth stating because they are product rules, not just prompt text
(`openaiEngineer.ts` rules 4, 10, 12 + `docs/ENGINEER_NORTH_STAR.md` "Community position policy"):

- Every numeric spread row carries a **`positionBand`**: `below_typical` | `low` | `mid` | `high` |
  `above_typical`. Before recommending a direction the model must check it: pushing a parameter that is
  already `above_typical` further out is legal but must be flagged and justified.
- **`spread.sampleCount` gates trust.** Roughly ≤ 6 setups behind a band → it is *"a WEAK HINT, not a
  fact."* The model must say the data is thin and lean on mechanism + the driver's own runs instead.
  *"Moving away from a thin median is not 'going against the field', because there is barely a field."*
- **The median is never a target.** *"Some of the best setups sit well off it."*
- A large numeric gap between the user's value and the community median (e.g. 22.4 vs 4.6 for
  `downstop_rear`) is treated as a **scale-mismatch data-quality signal** — different sheets use
  different droop/downstop conventions. The model states the caveat and still recommends a direction
  from KB theory rather than dropping the parameter.
- **Grip-trend verdicts are computed deterministically, not left to the model.** Each numeric row
  carries `gripTrendSignal` with `delta`, `scale`, `score`, **Cliff's delta** (effect size, bands:
  <0.147 negligible, <0.33 small, <0.474 medium, ≥0.474 large), `quartilesDisjoint`,
  `minMeaningfulDelta` (per-parameter floor from `trendMinimumDeltas.ts` — e.g. 1000 cSt for diff oil,
  0.25° for camber), `meetsMinMeaningfulDelta`, and a fused `magnitude` of `flat` | `slight` |
  `material`. The prompt forbids claiming a median trend when `magnitude === "flat"`.
- A grip bucket only appears at all if it clears a **10-sample threshold**.
- When one `topValue` takes ≥ 50 % frequency, the model is told to prefer the **modal** value over the
  median ("most people run 7k diff oil (62 % of low-grip uploads)").

## 5.10 Access & verification rules

From `docs/ASSET_ACCESS_NORTH_STAR.md` (Phase 1 built 2026-07-13):

> **Anyone can create what they need to log a run, instantly — but only verified identities shape
> community data.**

- **Per-user assets** (car, tyre set, battery, setup document, setup snapshot): owner-only, no
  verification concept.
- **Global catalog** (track + layouts, tire type, additive type, calibration, event): open create, live
  instantly, `verifiedAt` null until the founder approves. Unverified rows are fully usable with a
  subtle badge.
- **Chassis type is the one exception — admin-only create**, because a chassis implies schema +
  calibration work a user can't finish, and it is the highest-stakes aggregation key. Missing chassis
  never blocks logging (pending-car flow → `ChassisTypeRequest` pings the founder).
- **Unified edit/delete rule**: *"Creator may edit and delete their row while it is unverified AND
  unused by others. Once verified, or once another user depends on it → admin-only."*
  (`src/lib/assets/catalogAccessLogic.ts` `canManageCatalogRow`, `catalogUsage.ts` `usedByOthers`.)
- **Unverified identities never form community buckets.**
- **Calibration auto-pick is verified-gated** — own ∪ verified only, via
  `calibrationsAutoPickableByUserWhere`. Consequence noted in the doc: *"At launch every `verifiedAt`
  is null, so cross-user auto-pick returns nothing until the founder verifies calibrations."*
- **Track field split refinement**: only grip/layout **tags** fall under the lock. GPS pins and
  LiveRC/Speedhive **URL contributions** stay open to any authed driver so the run-complete
  "mark location" loop keeps working.

**Team visibility**: `Run.shareWithTeam` (default true) hides a run from mutual-team surfaces when
false. One-way `TeammateLink` visibility is deliberately unaffected.

## 5.11 Engineer behavioural invariants

The system prompt (`src/lib/engineerPhase5/openaiEngineer.ts`, ~150 lines of `CHAT_SYSTEM`) encodes
hard physics locks, several added because the model was observed getting them backwards. These are
domain facts, so they belong here:

| Lock | Rule |
|---|---|
| **Damper oil** | **Thicker** = less reactive, easier, more compliant over bumps, calms initial steering, removes mid-corner rotation. **Lighter** = faster-reacting, more initial bite, edgier. To reduce bite → thicker. To add bite → lighter. Writing "lighter oil for compliance" is reversed |
| **Upper inner shims** | **Raising upper inner LOWERS roll centre** on that corner |
| **Under-lower-arm shims** | **Raising under-lower-arm RAISES roll centre** on that corner |
| **Upper outer shims** | **Lowering** upper outer **flattens** the link → tends toward **lower** RC. **Raising** angles it more → **higher** RC |
| **Rear toe-gain shims** | **FEWER** shims = more bump-in / more toe gain on compression = **more** rear grip mid–exit. MORE shims = less rear grip |
| **Front bump-steer shims** | **MORE** shims = more bump-in (front toe-in on compression) = more initial bite, edgier |
| **Front ARB** | Softer front ARB **adds** mid-corner front steering — balance shifts *forward* at that phase, not rearward |
| **Roll-centre absolutes** | Forbidden to state any numeric absolute RC height unless it comes from the `derived_*` computed-geometry rows. Relative language only otherwise |
| **Vocabulary** | "Responsive" is reserved for higher RC / more angled link / initial bite. Lower RC and flatter links are "smoother", "more rolled-in", "more in the track", "less initial bite" — **never** "responsive" |

**"On the track" vs "in the track"** is RC jargon the app takes seriously: higher RC + more angled
upper link ⇒ *on the track* (responsive, reactive, more initial bite). Lower RC + flatter link ⇒
*in the track* (smoother, more rolled-in, more mid-corner grip).

**Bite vs hold** (`content/vehicle-dynamics/concepts/bite-hold.md`) — the driver-facing framing:
*bite* = grip curve peaks sooner/higher/narrower (precise, pointy, drops away sharply); *hold* = peaks
later/lower/wider (a plateau, forgiving, lower ceiling). Neither is better; both extremes hurt.
Caused by **the speed of load transfer** — fast transfer → bite, slow → hold. Each axle has its own.

**Structural rules**: every suggested change must ship with its prediction — *"(a) the expected
effect, (b) what the driver should feel for on track, and (c) what outcome would tell us it did NOT
work."* Bare directional advice is forbidden: a recommendation must cite the user's current value, a
community figure, and a KB filename, or be hedged/omitted. Never contradict a retrieved KB snippet —
*"When your pre-trained intuition disagrees with a retrieved KB snippet, DEFER TO THE SNIPPET."*
Never compress a hedged KB line into a one-sided bullet.

**Failure modes, ranked worst-first** (`docs/ENGINEER_NORTH_STAR.md`): 1. False confidence (the
cardinal sin) 2. Generic/forum-tier advice 3. Laundry list 4. Over-hedging.
*"Over-hedging is preferable to overconfidence."*

---

# 6. Feature inventory

## 6.1 Built and working (verified in code)

### A. Authentication and access
**Flow:** `/login` → enter email → magic link emailed (or "Continue with Google" when
`AUTH_GOOGLE_ID`/`SECRET` are set) → callback → session.
- `src/app/login/page.tsx`, `src/app/login/verify-request/page.tsx`
- `src/auth.ts` — the magic-link email is a hand-written table-based HTML template branded as
  "JRC Engineer" with the recipient address HTML-escaped against markup injection.
- Allowlist enforced in the `signIn` callback; `sendVerificationRequest` silently returns for
  non-allowlisted addresses (no enumeration signal). Without SMTP configured, the link is logged to
  the dev console instead.
- `src/middleware.ts` gates everything else.
- `POST /api/auth/redeem-access-code` — shared-code signup path.
- `GET /api/auth/config-hint` — tells the login page which providers are configured.

### B. Log a run (pillar #1)
**Six-step wizard**, every step walked on every run (`src/lib/runs/wizardWalk.ts`):

| # | id | Label | Pre-run? |
|---|---|---|---|
| 1 | `session` | Session | ✔ |
| 2 | `equipment` | **Tires** (id kept for payload compat) | ✔ |
| 3 | `prep` | Prep | ✔ |
| 4 | `setup` | Setup | ✔ |
| 5 | `laps` | Laps | after run |
| 6 | `feel` | **Feedback** (id kept) | after run |

- Host: `src/components/runs/LogRunWizardHost.tsx`. Guards zero-car accounts with an "Add a car
  first" card — a fix dated 2026-07-22 for a documented dead end.
- Form: `src/components/runs/NewRunForm.tsx` (5,465 lines — the largest file in the repo).
- **Prefill is always offered, never automatic** (founder interview 2026-07-17): the wizard lands
  blank; the Session step offers the selected car's last run, one tap applies it. No staleness cutoff.
  "Start blank instead" remounts the form via a React key so GPS venue auto-pick re-runs.
- Drafts: `loggingIntent: "draft"` saves progress; `ResumeDraftChooser` resumes; a resumed run opens
  at `firstUnfinishedStep()`.
- First-run coaching: one quiet line per step (`firstRunCoachLine`), e.g. *"Tires aren't required to
  save. Pick what you're on if you know it."*
- Tyre sets are **created on save**, not on pick (`newTireSet` in the POST body) — *"abandoning the
  form never leaves an orphan set."*
- Save: `POST/PUT /api/runs/route.ts` (839 lines). It resolves the setup snapshot (merging a sparse
  delta onto a baseline), normalises tyre prep, computes and persists lap summaries, links imported
  lap sessions, auto-fetches weather from Open-Meteo at the session's actual time, and returns a
  "mark this track's location" prompt when appropriate.
- Sub-panels: `RunTireSelectionPanel`, `RunAdditiveTimingPanel`, `HandlingAssessmentFields`,
  `RunConditionsSection`, `SetupSheetStructured`, `LapTimesIngestPanel`, `RunLayoutPicker`,
  `FeelVsLastRunQuickPick`, `InlineNewTrackRow`.

### C. Lap-time ingestion
- **Parsers** (`src/lib/lapUrlParsers/registry.ts`, tried in order): `liveRcParser`, `myRcmParser`,
  `speedhivePracticeParser`, `speedhiveParser`, `httpTimingParser` (generic), `stubParser` (fallback).
- **Manual entry** and **screenshot OCR** (`src/lib/lapImageExtract/`, vision model) also supported —
  `LapSourceKind` = `manual | screenshot | url | csv` (csv reserved, not implemented).
- Routes: `POST /api/lap-time-sessions/import`, `/api/laps/parse-url-preview`,
  `/api/laps/extract-preview`, `/api/laps/discover-sessions`, `/api/laps/scan-day-url` (459 lines).
- **Auto-detection at events**: `src/lib/eventLapDetection/`, `eventLapDiscovery/` scan an event's
  practice and results URLs, match the driver, and create `ImportedLapTimeSession` rows with
  `eventDetectionSource` set. Dashboard shows a "Detected sessions" prompt.
- **Watchers + push**: `WatchedLapSource` rows plus `src/lib/lapWatch/speedhiveResultWatch.ts`, run by
  the Vercel cron every 5 minutes (`vercel.json` → `/api/cron/watch-results`, Bearer `CRON_SECRET`).
  Windowing means it only polls users participating in an event **active today** at a Speedhive-enabled
  track — *"cheap — usually zero"*. Dedupe via a per-user notified-URL set in `AppSetting` plus a
  4-hour freshness window. **It never auto-imports** — the push opens the log-run form.
- **Outlier handling**: `src/lib/lapImport/autoExcludeOutlierLaps.ts` sets `isIncluded: false` with a
  reason rather than deleting laps.
- **MyLaps OAuth account link**: `/api/mylaps/{connect,callback,link,status,disconnect}` (Azure AD B2C).

### D. Sessions / run history
- `/runs/history` (`src/app/runs/history/page.tsx`, `RunHistoryTable.tsx` 1,346 lines,
  `SessionsFilterBar.tsx` 883 lines, `runHistoryFilters.ts` 845 lines).
- **There is no `/runs/[id]` detail page** — run detail is an expanded row inside the history table.
  Deep links use `/runs/history?focusRun=<id>` (backlog item FB-16, shipped).
- Team view via `?teamId=<id>`: shows members' runs with a Member column, reorder disabled, and
  Edit/Delete hidden on peer rows.
- Drag-to-reorder writes `sortAt` via `POST /api/runs/[id]/reorder`.

### E. The Engineer
This is the largest subsystem: `src/lib/engineerPhase5/`, 142 files, 23,059 LOC.

**Chat** — `/engineer` (`EngineerPageClient.tsx`, `EngineerChatPanel.tsx`) →
`POST /api/engineer/chat` (470 lines).

*Pipeline:* rate-limit + AI-budget check → deterministic fast paths
(`tryAnswerLapHistoryQuery`, `tryAnswerComparisonQuery`, `tryAnswerPlanningQuery` — these answer
without an LLM call when the question is purely a data lookup) → context assembly
(`engineerChatPipeline.ts`, `contextPacket.ts` 990 lines, `engineerRichContext.ts` 526 lines) →
tier decision (`engineerChatContextTier.ts`: `light` vs `full`) → slimming to a char budget
(`slimEngineerChatContextForApi.ts`) → OpenAI call with tools → persist exchange + capture
gold-set candidate.

*Modes* (`engineerChatMode.ts`) — user-selectable, persisted:
- **quick** — trackside. ≤ 150 words. "The read" then "the call". One change. *"No change — verify"*
  is a first-class recommendation. Full-strength model regardless (hard rule: no cheap models on the
  advice path).
- **normal** — default.
- **deep** — at-home debrief; multi-run analysis, what-ifs, mechanism teaching.

*Tap-to-answer*: the model may append `[[choices: A | B | C]]` on the final line (2–5 options,
≤ 4 words each); the client renders tap buttons with free-text fallback.

*Tools available to the model*: `list_linked_teammates`, `search_runs` (with `owner_scope`),
`apply_engineer_focus`, `kb_search`, `get_param_spread`, `compare_tires`, `tire_history_at_track`
(`engineerRunSearchTools.ts`, `reasoningSpine/spineTools.ts`).

*Knowledge*: the **whole** `content/vehicle-dynamics/` corpus is injected as the first system message
on full-tier advice turns (`fullKbInContext.ts`) — byte-stable so it prompt-caches. Retrieval was
retired for those turns; it only returns if the corpus exceeds ~190K chars. Light-tier and non-chat
surfaces still use keyword retrieval (`vehicleDynamicsKb.ts`). Drafts are labelled and must be cited
hedged: *"per draft `x.md` — not founder-verified"*; when a draft and an approved file disagree, the
approved file wins.

*Deterministic spine* (`engineeringBrain.ts`, `engineeringRead.ts` 995 lines): before the LLM sees
anything, the app computes `runQuality`, `feelRead`, `paceRead`, `changeRead`, `hypotheses`, and a
`recommendationStrategy` with `mode` ∈ celebrate | verify | diagnose | suggest_test |
suggest_compensation and `strength` ∈ soft | normal | strong. The prompt maps strength to verb
confidence: soft = "you could test…", strong = "the data points pretty clearly to…". The model is
told **not to re-derive** these conclusions.

*Memory*: `knownGoodMemory.ts` (past high-rated setups on this car), `setupOutcomeMemory.ts`
(what happened after each past change direction — **caveat-only**: it may add a warning but must
never reverse or rank a suggestion by itself), `mechanismAnalogiesVsKnownGood` (KB-backed matches
between a proposed direction and a historical change even when the setup keys differ).

**Other Engineer surfaces:**
- `POST /api/engineer/quick-fix` — structured suggestion card on dashboard/run detail.
- `POST /api/engineer/summary`, `/api/runs/[id]/engineer-summary`, `/engineer-deep-dive`.
- `POST /api/engineer/between-run-hints` — cached proactive hints, invalidated by input fingerprint.
- `POST /api/engineer/compare-options`, `/run-slice`, `/pace-vs-field-digest`.
- `POST /api/engineer/messages/[messageId]/rating` — admin 0–10 star rating.

**Quality loop** (`docs/ENGINEER_ITERATION.md`): ask in-app → rate 0–10 (admin only) → export the
feedback inbox (Settings, or `npm run engineer:export-feedback`; on Vercel it downloads a zip because
serverless can't write to the repo) → improve prompt/context in an editor. Regression is a gold-set
batch eval (`npm run engineer:eval`) scored by an AI reviewer with tags: `wrong_physics` (**blocks
ship**), `missing_kb_citation`, `overconfident`, `ignored_context`, `good_hedge`, `good_grounding`.
Ship bar: **avg reviewer ≥ 4/5 and zero `wrong_physics`**.

**Benchmarks** (`scripts/engineer-bench/`): the decisive measured result recorded in
`docs/ENGINEER_NORTH_STAR.md` is that on the same 30-case set and pipeline, **gpt-4o scored 5.93/10
and gpt-5.5 scored 9.0/10 with zero failure tags** — 30/30 cases up. Founder blind ratings reproduced
the gap (8.3 vs 6.1) and validated the AI judge at **Pearson r = 0.726, MAE 1.10** (gate was 0.7).
gpt-5.5 became the default on 2026-07-07. Caveat recorded: the gpt-4o judge saturates at the top, so
**pairwise A/B** is the instrument for gpt-5.5-era comparisons.

### F. Dashboard
`/` → `src/components/dashboard/DashboardHome.tsx`, model from `src/lib/dashboardServer.ts`.
**Two auto-switched modes** (`docs/DASHBOARD_NORTH_STAR.md`):
- **Track day** (a run/draft was logged today, or today is inside an active event): Start/Finish-run
  CTA → **Day verdict card** → Things to try → Last 30 days.
  The verdict card is **computed only, no AI** (`src/lib/dashboardVerdict.ts`): *Pace* (day trend across
  today's runs, avg-top-5 preferred, ±0.05 s reads as steady, plus a sparkline), *Last change* (most
  recent setup-changing run and whether it helped; inside the noise band = "effect unclear"),
  *Consistency* (spread of the latest run's five best laps judged relative to lap length: ≤1 % tight,
  ≤2.5 % fair, beyond scrappy). Footer: one on-demand "Ask the Engineer about today" → quick mode.
- **Off day**: Start-run CTA → **Next outing card** (event countdown, one "last visit" line, open
  to-dos, the editable Test plan) → Things to do → Last 30 days. With no event booked it degrades to
  a plan-only card.

Boundary rule: *"Now & next only… one line per thing, pre-computed verdicts, never raw evidence."*
Run lists belong to Analysis.

### G. Analysis
`/analysis` — rebuilt as a debrief surface (July 2026): session trend chart, recent-runs accordion,
doors to video and setup compare. `/setup/comparison` for run-vs-run and setup-vs-setup diffs
(`src/lib/setupCompare/`, `setupComparison/`). Lap comparison grid at
`src/components/runs/LapComparisonColumnGrid.tsx` with the tinted delta cells described in §5.1.

### H. Setup sheet pipeline
1. **Upload** — `POST /api/setup-documents` / `client-upload` (direct-to-Blob for large files) /
   `quick-create` (703 lines).
2. **Resolve chassis** — `identifySheetCar()` reads the printed brand/model from a cropped header
   strip; `matchSheetModelForIdentifiedCar()` fuzzy-matches with year-form and apostrophe
   normalisation (`X4'22` ⇄ `Xray X4 2022`) plus a discriminative token rule (`X4` must not match
   `T4`). Confidence ≥ 0.6 links; otherwise offers one-tap car creation.
3. **Pick a calibration** — fingerprint-based auto-pick (pHash + anchor alignment), gated to own ∪
   verified calibrations for cross-user picks.
4. **Parse** — AcroForm field read, or text-token rules, or region crops + local PP-OCR
   (`onnxruntime-node`), or full-page vision LLM for uncalibrated documents.
5. **Review** — confidence-gated. **Trust boundary, evidence-grounded on the gold set:** *"100 % of the
   reader's confident mistakes are checkbox/choice fields. Zero are on free-text or numeric values."*
   Therefore free-text/numeric high-confidence auto-imports; **every** choice/checkbox field is routed
   to review regardless of confidence. Cost: ~40 checkbox confirms per sheet.
6. **Create setup** — `POST /api/setup-documents/[id]/create-setup` → a `SetupSnapshot`.
7. **Render** — a filled PDF is generated from the base template + calibration
   (`renderedSetupPdfPath`, versioned by `SETUP_PDF_RENDER_PIPELINE_VERSION`).

Measured accuracy on the founder-verified Xray X4'22 gold set (5 sheets × 104 fields,
`docs/SETUP_UPLOAD_NORTH_STAR.md`):

| Config | Correct | Correct-or-flagged | Confident mistakes |
|---|---|---|---|
| gpt-4o, full image only | 70.5 % | 83.0 % | 88 |
| gpt-4o + 2×2 tiles | 83.4 % | 92.1 % | 41 |
| gpt-5 (low reasoning), tiles + hints | 89.4 % | **96.0 %** | 21 |
| gpt-5 + gpt-4o cross-model | 85.2 % | **97.5 %** | 13 |
| **shipped reader** (marked-contract, cross-model) | 86.9 % | **96.9 %** | 16 |

Ship bar was ≥ 95 % correct-or-flagged. Levers learned: tiling, model choice, per-style checkbox
geometry hints, cross-model dual-pass (different models rarely agree on the same wrong number), and a
"marked" contract where choice fields must declare a visible mark or return empty.

**Bulk import** — `/setup/bulk-import`, plus a **PetitRC** importer
(`/api/setup-import-batches/[batchId]/petitrc`, `src/lib/petitrc/`) that pulls published setup sheets
from that community site.

### I. Chassis types & calibration authoring
`/setup-sheet-models` (list), `/new` (name + blank PDF → creates the chassis with an empty schema and
empty AcroForm calibration, lands in the calibration editor), `/[id]/schema` (layout editor),
`/[id]/kit-setup` (manufacturer baseline). Calibration editing at `/setup-calibrations/[id]` and
`/setup-documents/[id]/calibrate-image`.

**Template creation is hand-built, box-first (2026-07-22)** — the AI *naming* pass was deleted because
*"the founder renamed every drafted parameter, so the draft cost more than it saved."* The AcroForm
geometry remains the anchor; only the naming is manual.

### J. Roll centre / computed geometry
`src/lib/rollCenter/` — a 2D front-elevation double-wishbone kinematics engine. Each side is a 1-DOF
four-bar solved by **bisection on the lower-arm angle** until the tyre contact point sits on the
ground. **Validated against VSUSP** (an established external calculator) on the founder's measured
Awesomatix A800R: engine −9.09 mm front / −8.50 mm rear vs VSUSP −9.1 / −8.5; width 188.7 mm; static
camber −1.78°; 128/128 extreme-input combinations solve.

**Trust doctrine**: *"deltas between two solves are instrument-grade; absolute values inherit the
pack's verification grade"* — `PackVerificationGrade` ∈ `measured` | `cross-checked` | `cad-verified`.
The A800 pack is `cross-checked`. The Engineer must word absolutes as "from your measured geometry",
never as certainty; deltas are exact regardless of datum error.

Measured A800R shim sensitivities (mm RC per mm of stack): under lower arm **+2.2**, under hub **+2.1**,
upper inner **−1.0**, upper outer **+1.0**; ride height +1 mm → RC +1.2 mm vs ground.

Surfaces: `/analysis/roll-center` (the "Lab"), plus `derived_*` rows injected into the Engineer's
spread context. A **VSUSP URL parser** decodes share-links (everything at mm × 1000 — including
`tires.compression`, where 125 means 0.125 mm squash, *not* a percent; this was the one decode bug
found during validation).

### K. Community aggregations
`POST /api/setup-aggregations/rebuild` rebuilds both tables. `/api/setup-aggregations/parameters`,
`/community`, `/grip-archetypes`, `/reset-to-batch`. Debug surface at `/setup/aggregations-debug`
showing exclusion counters. Per-car archetypes at `/cars/[carId]/grip-archetypes`.

### L. Teams & teammates
`/teams` — create a team, add allowlisted users by email. `/api/teams`, `/api/teams/[teamId]/members`,
`/api/teammates`, `/api/teammates/[peerUserId]`. Team run visibility in Sessions via `?teamId=`;
Engineer "Teammate" compare mode lists both linked teammates and team-only peers, filtered to the same
track as the primary run. Membership is currently **seed- or API-created only** — there is no invite
flow (`docs/TEAMS_POST_PILOT_HARDENING.md`).

### M. PWA & notifications
Manifest (`src/app/manifest.ts`), service worker (`public/sw.js` — push + notificationclick + a
minimal offline shell; deliberately **no page/API caching** to avoid stale-data bugs), registered
prod-only. Standalone detection sets `html[data-standalone]` pre-paint, gating native-feel CSS (no
rubber-band, no tap-flash, no long-press callout) to installed launches only. iOS-Safari-only install
prompt from the 2nd visit, dismissal persists ~60 days. VAPID web push + APNs native push, both with
their own device tables. `POST /api/push/{subscribe,unsubscribe,test,watch-test}`,
`/api/push/native/{register,unregister}`.

### N. Billing (built, dark)
`/billing` plan picker → `POST /api/billing/checkout` (Stripe Checkout Session) and
`/api/billing/portal`. `POST /api/stripe/webhook` is the sole entitlement authority: Node runtime, raw
body for signature verification, idempotent via `StripeWebhookEvent`.

Tiers (`src/lib/entitlementLogic.ts`):
- `standard` → `logging`, `review`, `compare`, `engineer`
- `pro` → all of the above + `video`, `roll-center`
- The Engineer is in **both** tiers — the Standard/Pro difference on AI is a usage cap
  (`AiUsageDaily`), not a feature gate.
- Active statuses: `active`, `trialing` only. An unrecognised tier string fails **safe to standard**,
  never to pro.
- `BILLING_ENFORCED !== "1"` → paywall fully dark, everyone gets Pro.
- Allowlisted and admin emails are grandfathered to Pro even when enforcement is on
  (`.env.example`).
- Indicative pricing in `.env.example` comments: **Standard $14.99/mo, Pro $24.99/mo AUD**, plus annual.

**AI spend caps** (`src/lib/aiUsage/budgets.ts`): default 60 calls/day for `engineer-chat`, 40 for
`engineer-quick-fix`, 25 for `setup-extract`; **$3/day and $25/rolling-30-days** across all features.
Cost is estimated from a model-rate table (gpt-4o $2.5/$10 per Mtok; gpt-5/gpt-5.5 $1.25/$10;
gpt-4o-mini $0.15/$0.60) with a deliberately expensive `UNKNOWN_MODEL_RATE` of $5/$20 *"so a new model
can't slip past the ceiling by being unpriced."* User-facing messages are phrased for a driver:
*"You've used today's AI allowance. It resets tomorrow."*

### O. Admin
`/setup/admin` and `/admin/review` (the founder review queue: unverified catalog rows + pending
chassis requests, one-tap approve, merge, delete). Settings surfaces the sign-in allowlist, Engineer
feedback export, and gold-set candidate review to `AUTH_ADMIN_EMAILS` users.

### P. Onboarding (current model, after a 2026-07-23 reversal)
Two surfaces only:
1. **Welcome overlay** — full-screen, shown once on a truly-empty first sign-in, gated by
   `onboardingSeenAt`. Framing line + three value bullets + "Get set up" / "Look around". Deliberately
   an overlay, **not** a `/welcome` route (no redirect flash, no PWA back-strand).
2. **"Get set up" card** on the dashboard — rows are **real links** (no dead clicks). Only a **car** is
   required; once one exists the card flips to "You're ready — log your first run", with Timing and
   Setup persisting as advised extras. Dismissible; self-retires.

Timing identity moved from required-up-front to **just-in-time** at the lap-ingest point.
`/welcome` is now a redirect stub. `src/lib/onboarding/server.ts` derives readiness (`hasCar`,
`hasTimingIdentity`, `hasSetup`, `hasAnyRun`, `seen`, `dismissed`) — never a stored counter.

## 6.2 Partially built / degraded

| Feature | State |
|---|---|
| **Video analysis** | Phases A + B built 2026-07-11 (session Video row, adapter, tools page, `AnalyzeFlowClient` 5-step mobile flow). **Not built:** crop UI in the new flow, real-footage validation pass, Phase C (camera profiles → track entity). Several orphaned components remain live in the tree but unrendered — see §9 |
| **Video data trace** | Phase 1 delta surface shipped 2026-07-10 (`LapComparePanel`), *"verified on synthetic results — real-footage gate open."* Phases 2–4 (metric survey, speed channels, Engineer integration) not built |
| **Dashboard Engineer suggestions** | The `EngineerDashboardSuggestion` model, `dashboardSuggestions/` lib and `/api/engineer/dashboard-suggestions` route all exist but are **dormant** — the auto-read card was deleted 2026-07-19 after producing *"generic, wrong, stale, waffly"* answers. Engineer on the dashboard is now on-demand only |
| **Parameter effect catalog** | `src/lib/engineerPhase5/parameterEffects/catalog.ts` is **deliberately empty**. The Phase B infrastructure ships dormant pending an A/B/C bench verdict on whether to use a mechanism graph, free reasoning, or enforced rails |
| **Batteries** | `Battery` model and `Run.batteryId` exist; *"Batteries were removed app-wide and have no UI"* (`docs/ONBOARDING_NORTH_STAR.md`) |
| **iOS shell** | Capacitor project exists, deep-link and push bridges are wired, TestFlight checklist written. Ship decision is explicitly still open ("iOS: yes or no? — within 6 months") |
| **PWM logger** | Firmware + KiCad carrier board + TypeScript BLE protocol parser (`src/lib/rcPwmLogger/bleProtocol.ts`) all exist. No app UI consumes it. Positioned in `PRODUCT_NORTH_STAR.md` as a 12–24-month investigation |
| **Access-code signup** | Route exists (`/api/auth/redeem-access-code`) but open signup is not the live model |
| **Onboarding phases 1–4** | All marked *"built 2026-07-22, **not yet driven in a browser**"* — never exercised as a real empty account because the dev DB is production |

## 6.3 Specified but NOT built

From `docs/NOT_YET_BUILT.md` (last reviewed 2026-07-08) — the repo maintains this honestly:

| Feature | State |
|---|---|
| **Results & Trophies** | Spec + visual prototype only, **no code**. No `EventResult` model, no `Event.level`, no `view_multi_main_result` parser, no trophy case. LiveRC result pages are parsed for laps, not finishing positions |
| **Next outing plan** | Founder idea only. Per-event plan built at home with the Engineer — starting-setup diff, ordered test plan with predictions, scenario branches. No model, no surface |
| **Sector compare (driver vs driver)** | Spec + interactive prototype on real data, **no code**. The prototype's data came from offline scripts, not repo code |
| **Engineer Phase 3** — suggestion lifecycle | `EngineerSuggestion` model, "trying this" → outcome linkback, self-citation of track record. **Not started.** Described as the #1 success metric and part of the moat |
| **Engineer Phase 4** — driver profile | Visible/editable style + preferences model, Engineer-proposed and driver-confirmed. Not started |
| **Engineer Phase 5** — mode auto-inference | Not started |
| **Engineer Phase 7** — understanding layer | LLM symptom/intent extraction replacing keyword gates. Gated on Phase 6 |
| **Engineer Phase 8** — staged reasoning + verify pass | Gated on Phase 6 |
| **Engineer Phase 9** — weekend model | Per-event "engineer's notebook". Described as *"the biggest product leap."* Gated on Phase 6 |
| **Grip → per-run capture** | `Track.gripTags` is called *"a modeling error"* — grip changes day to day, and a shared-track edit silently reshaped everyone's condition buckets. Target is per-run capture with the track providing a prefill default. Phase 4 of the access rollout; **not started** |
| **Team invites, roles, leave/delete** | Backlog only |
| **Setup upload phone-photo lane** | In scope only if it clears the eval bar |

## 6.4 API surface summary (171 routes)

Grouped by prefix: `action-items`, `additive-types`, `admin/*`, `auth/*`, `billing/*`, `cars/*`,
`chassis-requests`, `cron/watch-results`, `engineer/*` (11 routes), `events/*`, `health/*`,
`lap-time-sessions/*`, `lap-watch/*`, `laps/*`, `mylaps/*`, `new-run/bootstrap`, `onboarding`,
`petitrc/preview`, `profile-image`, `push/*`, `runs/*` (20 routes), `settings/*`, `setup/*`,
`setup-aggregations/*`, `setup-calibrations/*`, `setup-documents/*` (16 routes),
`setup-import-batches/*`, `setup-sheet-models/*`, `setup-snapshots/*`, `stripe/webhook`, `teammates/*`,
`teams/*`, `tire-sets/*`, `tire-types/*`, `tracks/*`, `video-analysis/*`, `videos/*`, `weather`,
`_debug/{db-ping,version}`.

---

# 7. Design system

Source of truth: `docs/VISUAL_NORTH_STAR.md` ("Technical v2", **Locked**, June 2026). Tokens live in
`src/app/globals.css` `:root` as **space-separated RGB triplets**, consumed through
`tailwind.config.ts` with `<alpha-value>` support.

> North star sentence: *"A premium racing instrument: charcoal graphite surfaces, electric-but-confident
> yellow for every action, Sora for all UI type, JetBrains Mono for data. Two voices — friendly prose to
> learn, mono instrument panel to trust — never cold, never gimmicky."*

## 7.1 Colour tokens

| Token | Hex | CSS var / Tailwind | Role |
|---|---|---|---|
| bg | `#121110` | `--color-background` / `bg-background` | App background |
| surface | `#181716` | `--color-card` / `bg-card` | Cards, panels |
| surface-inset | `#151413` | `--color-secondary`, `--color-input` | Inputs, inset areas |
| elevated | `#1E1D1C` | `--color-muted` | Hover, menus, raised |
| line | `#282726` | `--color-border` | 1px hairline borders |
| ink | `#ECE9E4` | `--color-foreground` | Primary text |
| ink-2 | `#A09D96` | `--color-muted-foreground` | Secondary text |
| ink-3 | `#64625E` | `--color-faint` / `text-faint` | Labels, captions |
| **accent** | **`#FFD60A`** | `--color-primary`, `--color-accent`, `--color-ring` | **Brand + all primary actions** |
| accent-hover | `#E6BE00` | literal on yellow CTAs | Pressed/hover |
| accent-fg | `#121110` | `--color-primary-foreground` | Text **on** yellow |
| gain | `#4FD089` | ad hoc | Positive data (faster, improved) |
| loss | `#E5644E` | `--color-destructive` | Negative data, errors |

**Rules:**
1. **Yellow = action only.** CTAs, focus rings, active nav, and the page-title timing-line segment
   (which is nav-position *information*). *"Never use yellow to mean 'fast lap' or 'good data.'"*
2. **Green/red = pace and quality deltas only.** Volume deltas (fewer runs, laps, wheel time) are
   *less*, not a failure — they render in muted ink with a plain ↑/↓.
3. **Dark text on yellow, always** — never white on yellow.
4. Retired and not to be reintroduced: red primary `#c92a2a`, blue accent `#2563eb`, the red/blue body
   mesh, dusty rose `#D9A299`, cool-grey "runna" surfaces, italic uppercase Montserrat chrome.

## 7.2 Typography — two voices

Loaded in `src/app/layout.tsx` via `next/font/google`. Sora and JetBrains Mono are SIL OFL.

| Tier | Font | Weights | CSS hook |
|---|---|---|---|
| **Display** | **Space Grotesk** | 700 only | `--font-display` — **`.page-title` only** |
| **1 — UI sans** | **Sora** | 400/500/600/700 | `--font-ui`, `font-sans` |
| **2 — Data** | **JetBrains Mono** | 400/500/700 | `--font-mono-jb`, `font-mono` |

Element → tier matrix (abridged from the locked table):

| Element | Font | Size | Weight | Case / tracking |
|---|---|---|---|---|
| Page title `.page-title` | Space Grotesk | `clamp(22px,4vw,30px)` | 700 | `-0.01em`, with a skewed −21° yellow "timing line" sector beneath |
| Hero card title `PanelTitle` | Sora | 20–22px | 700 | sentence, tracking-tight |
| Hub row title `HubRowTitle` | Sora | 17–18px | 600 | sentence |
| Section header `SectionTitle` | Sora | 13–14px | 700 | sentence |
| Eyebrow / data label | JetBrains Mono | 10px | 400 | **UPPERCASE, `0.28em` tracking** |
| Table column header | JetBrains Mono | 10px | 400 | UPPERCASE, `0.28em`, faint |
| Stat value `StatTile` | JetBrains Mono | 18px | 500 | tabular-nums |
| Timestamps | JetBrains Mono | 10px | 400 | tabular-nums, faint |
| Lap times, deltas, setup values | JetBrains Mono | varies | 400–500 | tabular-nums |
| Body / chat prose | Sora | 13–15px | 400 | sentence — **inline numbers stay Sora** |
| Chat speaker tags | Sora | 10px | 600 | sentence — deliberately **not** an Eyebrow |

Rules: never mix tiers on the same semantic role · one display face in one place · mono micro-label
tracking is always `0.28em` (no `0.2em`/`0.14em` one-offs) · prefer `font-mono` over
`font-sans tabular-nums` for numeric data · **never set inline `fontFamily`**.
Retired and no longer loaded: Heebo, HK Grotesk Wide, Montserrat, Geist Sans, Archivo Expanded, Inter.

## 7.3 Geometry, spacing, motion

| Element | Radius | Tailwind |
|---|---|---|
| Hero panel | 16px | `rounded-2xl` |
| Card / panel | 12px | `rounded-xl` |
| Button / input | 8px | `rounded-lg` |
| Badge / chip | 6px | `rounded-md` |

Borders: 1px hairline `border-border`. Spacing scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 (Tailwind
default). Shadows: `boxShadow.glow` = `0 0 24px -4px rgb(var(--glow-shadow-rgb) / 0.28)` — a subtle
yellow lift on active chrome, plus `glow-sm`.

**Motion is minimal and largely undocumented** — the spec has no motion section beyond hover glow on
cards and a splash fade (`PwaSplashDismiss`). **UNVERIFIED:** whether a systematic transition/easing
scale exists; I did not read all of `globals.css`'s 1,189 lines.

## 7.4 Background treatment

The app shell uses a **TITC sunset photo wash** — `public/brand/track-hero.jpg` layered on `.page-bg`
children, fixed position, identical on every screen. Founder-tuned 2026-07-06 to blur 12px / yellow 0 /
dark 0.6, with those knobs exposed as `--tune-*` vars in `:root` and a dev-only `AppearanceTuner` that
overrides them live. As of a 2026-07-14 performance bake the blur and grade are **pre-baked into the
JPEG** and the runtime blend-mode layers are gone. Charcoal radial gradients on `.page-bg` remain as
the loading fallback.

Cards use **liquid glass** — `.glass-card`: `card/0.7` + `backdrop-blur(78px) saturate(1.3)`, white/0.10
border, specular top rim. Hard limit: *"do not drop card alpha below ~0.6"* (legibility over the photo).

The mobile dock is a 56px glass bar: `card/0.32` + `backdrop-blur(40px) saturate(1.9)`.

## 7.5 Component vocabulary (do not invent parallels)

| Primitive | File |
|---|---|
| `SurfaceCard` (variants `hero` \| `panel`) | `src/components/ui/SurfaceCard.tsx` |
| `CardPanel` | `src/components/ui/CardPanel.tsx` |
| `HeroPanel` (legacy — prefer `SurfaceCard variant="hero"`) | `src/components/ui/HeroPanel.tsx` |
| `PanelTitle`, `PanelSubtitle`, `HubRowTitle`, `Eyebrow`, `StatStrip`, `StatTile` | `src/components/ui/panel.tsx` |
| `Button`, `ButtonLink` | `src/components/ui/Button.tsx`, `ButtonLink.tsx` |
| `SectionTitle` | `src/components/ui/SectionTitle.tsx` |

## 7.6 Navigation chrome

**Mobile dock** (one row since 2026-07-14): a 56px glass bar holding the **Ideas** utility cap
(lightbulb → Ideas & reminders sheet, app-wide, no count badge) plus five destinations — Dashboard ·
Analysis · Assets · Engineer · Teams (26px icons, icon-only since 2026-07-03) — with the icon-only
yellow **Log run** circle (56px) floating beside the bar's right end. Draft state shows a flag icon +
green dot. Static on scroll. On create/edit routes the circle is suppressed and the bar stretches
(`shouldShowLogRunFab` in `navConfig.ts`). **Settings lives behind the top-right account avatar**
(`AccountMenu`). The desktop sidebar keeps Add run + Settings and gains Teams.

Active-tab resolution is **longest-prefix** (`resolveActiveNavId`), with `ANALYSIS_PREFIXES` and
`ASSETS_PREFIXES` lists mapping many routes onto five tabs.

## 7.7 Rollout status (what actually looks finished)

| Tier | Screens | Status |
|---|---|---|
| A1 `/login` | ✅ | done |
| A2 `/` dashboard | ✅ | panel primitives + hero |
| A3 `/runs/new` | ⬜ | tokens only — needs a panel pass |
| A4 `/runs/history` | 🟡 | mono table headers + Eyebrow sections |
| A5 `/engineer` | 🟡 | partial |
| B1 `/assets` | 🟡 | partial |
| B2–B5 cars/tracks/events/tires/additives | ⬜ | not started |
| B6 `/analysis` | ✅ | rebuilt July 2026 |
| Tier C (setup pipeline, analysis tools, run edit, settings, utility) | 🟡/⬜ | Eyebrow labels only |

Self-reported gap: *"`panel.tsx` only on dashboard + partial engineer; 37+ other routes use ad-hoc
patterns."*

## 7.8 Accessibility

Requirements stated: works at **390 px** with the bottom dock visible; `viewportFit: "cover"` so
`env(safe-area-inset-*)` returns real values on notched phones. **Zoom is fully disabled**, which is a
deliberate founder decision but is an accessibility regression worth flagging. **UNVERIFIED:** contrast
ratios, focus-visible coverage, screen-reader labelling, and reduced-motion handling were not audited.

---

# 8. Key architectural decisions & trade-offs

**1. Server Components + route handlers, no client state library.** No Redux/Zustand/React Query in
`package.json`. Pages load their model server-side (e.g. `getCachedDashboardHomeModel`) and pass it
down; mutations go to route handlers and invalidate user-scoped cache tags
(`src/lib/revalidateUser.ts`). *Trade-off:* fewer moving parts and no cache-coherence layer, at the
cost of some very large client components (`NewRunForm.tsx` at 5,465 lines holds a lot of local state).

**2. JSON blobs for setup and lap data instead of normalised tables.** `SetupSnapshot.data`,
`Run.lapTimes`, `Run.lapSession`, `Run.tirePrep`, `Run.handlingAssessmentJson`,
`SetupSheetModel.schemaJson` are all `Json`. *Reasoning:* every chassis has a different parameter set,
so a normalised `parameter` table would be a giant EAV. *Trade-off:* no DB-level constraints on setup
values; every blob needs a versioned parser with migrate-on-read
(`handlingAssessmentJson` is on **version 6** with v1–v5 migration paths). Aggregation requires a
materialisation pass rather than a SQL query.

**3. Materialised aggregations rather than live queries.** `SetupParameterAggregation` and
`CommunitySetupParameterAggregation` are rebuilt in a batch. *Trade-off:* explicitly documented as a
footgun — *"after a change that affects stats, rebuild… or numbers go stale silently."*

**4. Denormalised snapshot columns everywhere.** `carNameSnapshot`, `trackNameSnapshot`,
`trackLayoutNameSnapshot`, `Event.legacyTrackJson`, `RunImportedLapSet.sessionCompletedAt`,
`Run.bestLapSeconds` / `avgTop5LapSeconds`. *Reasoning:* history must survive deletion of a shared
catalog row, and list views must not recompute from JSON per row. *Trade-off:* two sources of truth
that can drift.

**5. `sortAt` as a separate ordering axis.** Rather than sorting by any timestamp that could change,
run order is stamped once and only moves on explicit user action. *Reasoning* (verbatim from the
schema): *"so that 'if B was completed after A, B stays above A forever' holds regardless of edits,
re-imports, or lap-time changes."*

**6. Full-KB-in-context, retrieval retired for advice turns.** The whole vehicle-dynamics corpus
(~38.5K chars ≈ 10K tokens) is the first system message on full-tier turns, byte-stable so it
prompt-caches. *Reasoning:* *"Kills the retrieval-miss failure class."* *Trade-off:* it consumes a
large share of the token budget, forcing a 14K-char clamp on the context JSON under gpt-4o's 30K-TPM
pool. Mitigations built: a kill switch (`ENGINEER_FULL_KB_IN_CONTEXT=0`), automatic KB-block drop on
"request too large" or persistent 429 (restoring retrieval snippets and the full budget with a
`console.warn`), and an automatic return to retrieval if the corpus outgrows ~190K chars. The clamp is
only applied for gpt-4o models — gpt-5.x has a 500K-TPM pool.

**7. A deterministic "engineering brain" in front of the LLM.** Run quality, pace read, feel read,
change read, and a recommendation mode/strength are computed in TypeScript and handed to the model as
the spine of its reply, with an instruction not to re-derive them. *Reasoning:* keeps the parts that
must be reproducible out of the model's hands; the LLM's job is explanation and judgement, not
arithmetic. Deterministic routes (`deterministicRoutes.ts`) can answer some questions with **no LLM
call at all**.

**8. Statistical verdicts computed, not inferred.** `gripTrendSignal`, `cliffsDelta`,
`quartilesDisjoint`, `minMeaningfulDelta`, `positionBand`, `magnitude` are all computed and the model
is instructed to prefer them over re-deriving magnitude from raw medians. *Reasoning:* LLMs are
unreliable at judging whether a difference is meaningful; the app decides, the model explains.

**9. Hard-coded physics locks in the prompt.** Several rules exist explicitly because the model was
observed getting them backwards ("LOCK — the Engineer has been observed reversing this" appears on
damper oil and toe-gain shims). *Trade-off:* the prompt is ~150 dense lines and growing, which is
itself a maintenance and token cost, but it is measurably cheaper than being wrong about physics in
front of a paying racer.

**10. No cheap models on the advice path.** Quick (trackside) mode uses the same full-strength model as
everything else; brevity comes from the prompt contract. *Reasoning:* *"Trackside is the most
consequential answer the Engineer gives."* Cheap models are permitted only for non-advice plumbing.

**11. Open catalog creation + a verified flag, rather than admin-gated creation.** *Reasoning:*
*"Never block logging (pillar #1): a driver at an unlisted track must be able to create it between
runs."* And: *"'100 % correct' means the verified subset, not the whole catalog."* *Trade-off:* an
approval queue that will rot without a nudge — which is exactly why `/admin/review` plus a push nudge
was specified.

**12. Confidence-gated setup extraction with an evidence-grounded trust boundary.** Rather than a
uniform confidence threshold, the split (auto-import numerics, always review choices) was derived from
a measured fact about *where* the model is confidently wrong. *Trade-off:* ~40 checkbox confirms per
sheet today; region mark-detection (Stage 2) is the planned fix and the doc says the argument for it
"now rests on data."

**13. Local-first video storage.** Heat videos are ~1 GB; uploading by default was rejected. Videos
stay on the phone and "save to library" is opt-in. *Trade-off:* clips in the compare surface only work
for saved videos, and this is labelled as such in the UI.

**14. Python video worker kept out of the server.** *"Import lane only — no server-side worker until
the pipeline earns it (platform-bet rule)."* The app imports the worker's JSON
(`VideoAnalysisResultV1`); the heavy CV never runs on Vercel.

**15. Two push transports, two tables.** Web Push and APNs were not unified because *"an APNs/FCM token
is a single opaque string — there is no endpoint URL or key pair to store, and the send path is a
different transport."*

**16. Durable AI spend ledger separate from the rate limiter.** The in-memory limiter is explicitly
described as a burst brake whose real ceiling on serverless is `limit × instance count`. The
`AiUsageDaily` rollup (not per-call rows) is the actual cap; per-call forensics are left to the OpenAI
dashboard.

**17. Entitlement derived server-side from Stripe webhooks only.** The webhook is *"the ONLY source of
truth"*; the client is never trusted; unknown tier strings fail safe to the cheaper grant.

**18. The paywall ships dark behind one env flag.** `BILLING_ENFORCED` keeps the app
*"byte-for-byte unchanged for existing users until the founder deliberately flips it on."*

**19. Docs-as-specs with honest status tables.** 30 north-star docs, each with a rollout table using
✅/🟡/⬜, plus `docs/NOT_YET_BUILT.md` as a registry whose stated purpose is that *"a spec is intent,
not shipped code."* This is unusual discipline for a solo project and is the main reason this briefing
can be written accurately.

**20. Agent guard-rails as executable hooks.** Rather than trusting prose, `.claude/hooks/` contains
PreToolUse scripts that force a confirmation prompt on `prisma db push` and on any write to the locked
KB. The db-push guard's comment is candid about why it asks rather than denies: *"on this machine the
local `.env.local` sometimes points at the real prod DB."*

---

# 9. Known issues, tech debt, TODO inventory

## 9.1 Literal TODO / FIXME

**Essentially zero.** A full grep of `src/`, `scripts/`, `prisma/` finds:
- **1 `TODO`** — `scripts/setup-extract-eval/demo-upload.ts:3` (*"the in-app UI wiring is still TODO"*).
- **0 `FIXME`**, **0 `HACK`**, **0 `XXX:`**.

Debt is tracked instead in `@deprecated` markers, doc status tables, and `docs/NOT_YET_BUILT.md`.

## 9.2 `@deprecated` inventory (40 markers)

| File | What's deprecated |
|---|---|
| `src/lib/appThemePreview.ts` | 6 markers — an entire legacy theme-preview API migrated to `BG_PREVIEW_*` |
| `src/lib/runHandlingAssessment.ts` | `feelGeneral` (retired from capture 2026-07-08), legacy v1 trait ids, v2 dual-axis balance |
| `src/lib/manualVideoAnalysis/{loadTiming,sync,types}.ts` | 5 markers — pre-session-scoped timing loaders and v1 shape |
| `src/lib/engineerPhase5/setupCompareAxleNet.ts` | 2 bulkhead-split accessors superseded by `setupBulkheadInnerSplits` |
| `src/lib/setupSheetModels/enrichGroupedFieldOptions.ts` | 2 — catalog-injecting normalisers |
| `src/lib/setupCalibrations/customFieldCatalog.ts` | Partial template getter |
| `src/lib/setupCalibrations/modelCalibrationMapping.ts` | `sanitizeFormFieldMappings` — *"schema-only prune is unsafe on load"* |
| `src/lib/setup/derivedFields.ts` | 2 — old status enum + `deriveFieldStatuses` predecessor |
| `src/lib/lapImport/autoExcludeOutlierLaps.ts` | Symmetric outlier band (superseded by fast/slow bands) |
| `src/lib/eventActive.ts`, `dashboardServer.ts` | Timezone-naive event-active check; re-export shim |
| `src/lib/setupAggregations/rebuildCarParameterAggregations.ts` | Legacy counter field |
| `src/components/ui/SearchableSelect.tsx` | 2 — search props are no-ops (native `<select>`) |
| `src/components/dashboard/ThingsToTrySection.tsx` | Superseded by `ActionItemListPanel` |
| `src/lib/videos/storage.ts`, `setupCompare/compareHighlight.ts`, `runSetup.ts`, `engineeringRead.ts`, `betweenRunHintTypes.ts`, `DeriveImageMapButton.tsx`, `useVideoOverlayFrameLockSync.ts` | 1 each |

## 9.3 Schema / code drift

- **`Car.carClass`** — the schema comment says it drives the car-swap rule; `src/lib/cars/carClasses.ts`
  says the field is *"dormant and unread"* and platform is inferred from the chassis instead. The
  schema comment is stale.
- **`Battery`** — full model, relations and `Run.batteryRunNumber` exist with no UI.
- **`SetupSheetCalibration.communityShared`** — documented as a *"legacy flag"* that no longer gates
  anything.
- **`EngineerDashboardSuggestion` + `dashboardSuggestions/` + its API route** — dormant after the
  auto-read card was deleted.
- **`AppSetting` key `onboardingSkippedSteps`** — *"Kept because old accounts have `["sheet"]` stored;
  nothing writes it now."*
- **`AGENTS.md` points at `.cursor/skills/security-architect/SKILL.md`** and
  `docs/ENGINEER_ITERATION.md` points at `.cursor/skills/engineer-improver/SKILL.md`. **Neither
  exists** — `.cursor/` contains only `rules/simple-english.mdc` and
  `rules/vehicle-dynamics-kb-protection.mdc`.
- **`.claude/settings.json`** allows a Bash command pointing at a scratchpad path under
  `c--Users-Jordan-Documents-rc-engineer-app` — a **stale path** (the repo now lives at
  `C:\Users\Jordan\rc-engineer-app`).
- **`.env.example` says the Engineer default model is gpt-4o**; the code default is `gpt-5.5`
  (`openaiEngineer.ts` `ENGINEER_DEFAULT_MODEL`). The env comment is out of date.
- **`docs/ONBOARDING_NORTH_STAR.md`'s code map** references deleted files
  (`WelcomeWizardClient`, `OnboardingResumeCard`, `lib/onboarding/progress.ts`) — the doc flags this
  itself in its reversal header, but the map below it was not updated.

## 9.4 Migration / deployment debt

- **71 migrations, with a `prisma/manual-recovery/` directory** holding 4 SQL files
  (`setup_parameter_condition_scope`, `action_item_list_kind_and_suggested_prerun`, `teams_pilot`,
  `run_share_with_team`) plus dedicated `db:migrate:resolve:*` npm scripts for three of them — evidence
  of past migration-state drift, with `npm run db:migrate:reconcile` as the documented repair path.
- **Two migrations share the same timestamp prefix** (`20260410120000_setup_parameter_condition_scope`
  and `20260410120000_watched_source_target_mode`; also two at `20260528120000` and two at
  `20260528140000` / `20260410180000`). Prisma orders by directory name, so this resolves, but it is
  fragile.
- **The `verifiedAt` migration** (`20260713120000_add_catalog_verified_at`) was recorded in
  `ASSET_ACCESS_NORTH_STAR.md` as *"written but NOT applied to prod."* **UNVERIFIED:** whether it has
  since been applied — I did not query the database.
- **The `enrich_tiretype` migration is uncommitted** (untracked in `git status`) along with
  `scripts/import-touring-tires.ts` and three new KB concept files.
- **Deferred unique constraints not yet added**: `Track.name` (case-insensitive) and
  `Event(trackId, resultsSourceUrl)`. Both would fail on existing duplicates until
  `scripts/dedupe-events.ts` / `dedupe-setup-sheet-models.ts` run first.
- **Windows `prisma generate` EPERM** is a recurring hazard — a running dev server holds the query-engine
  DLL. `src/lib/prisma.ts` contains a startup assertion whose error message walks the user through it.

## 9.5 Orphaned / dead code

From `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md`'s audit, still pending Phase C retirement:
- `VideoAnalysisHub.tsx` — *"contains the only 'recent sessions' list — never rendered, so users
  cannot return to past sessions except by URL."*
- `VideoLibraryClient.tsx` — the whole upload library, never rendered.
- `VideoOverlayClient.tsx` and family — legacy overlay; the route redirects away.
- `UnifiedVideoAnalysisClient`, redirect routes, param-gated `jobs/new`.

Also: `/welcome` is a redirect-only stub; `/garage` redirects to `/assets`.

## 9.6 Known functional bugs / gaps

- **FB-19 (priority 2, not started)** — *"Time of day / event running still seems off, think based on
  utc."* Given the three-timestamp model in §5.2 this is the highest-risk open correctness issue.
- **20 of 23 items in `docs/USER_FEEDBACK_BACKLOG.md` are unstarted**, including several correctness or
  consistency items: FB-14 (cannot clear a selected option on a calibrated setup sheet — the selection
  is sticky), FB-15 (decimal-place consistency across fields/tables/exports), FB-11 (droop measurement
  methods with different conventions are pooled into one aggregation — apples to oranges), FB-17
  (Engineer summary overflows on phone in the Sessions view).
- **Onboarding was never exercised on a real empty account** — *"the dev DB is production, so a
  throwaway allowlisted user is needed. Treat every row as unverified until that happens."*
- **Cross-user calibration auto-pick returns nothing** until the founder verifies calibrations, because
  every `verifiedAt` starts null. Flagged in the doc as expected but hit-rate-degrading.
- **Video Phase 1 was verified on synthetic results only** — the real-footage gate is open.
- **The AI judge's calibration exemplars leak** — 6 founder ratings became judge exemplars, so those
  cases must be excluded from future Pearson re-checks. Recorded, but easy to forget.
- **Setup aggregation staleness** has no automatic trigger; it relies on the developer remembering to
  POST the rebuild endpoint.
- **`checkApiRateLimit` is per-instance** and therefore not a real limit on Vercel — mitigated by
  `AiUsageDaily` for AI paths, but any non-AI route relying on it is effectively unlimited.

## 9.7 Structural size debt

`NewRunForm.tsx` (5,465 lines), `SetupSheetStructured.tsx` (2,292), `LapTimesIngestPanel.tsx` (1,507),
`RunHistoryTable.tsx` (1,346), `runHandlingAssessment.ts` (1,192), `dashboardServer.ts` (1,012),
`engineeringRead.ts` (995), `contextPacket.ts` (990), `openaiEngineer.ts` (926),
`layoutCanvasOps.ts` (887), `runHistoryFilters.ts` (845), `POST /api/runs` (839). No lint rule caps
file size.

## 9.8 Testing debt

- 124 test files against 1,160 source files. Coverage is concentrated in pure-logic libs (lap maths,
  handling migration, roll centre, tyre chain, nav config, entitlement, grader metrics) — there appear
  to be **no component tests and no end-to-end tests**.
- No CI, so the 53 test scripts only run when a human remembers the right one.
- `AGENTS.md` states outright: *"never drive the app. Jordan does it himself"* — meaning agents ship
  changes verified only by typecheck + unit test + build, with browser verification deferred to the
  founder. Several features are consequently marked "built, not yet driven in a browser."

---

# 10. Open questions

Things a new contributor would have to ask a human.

## Product & strategy

1. **Is the paywall going live, and when?** `BILLING_ENFORCED` is off, Stripe price ids are unset, and
   `PRODUCT_NORTH_STAR.md` says *"Do not optimize monetization before the loop is habit-forming for
   beta users."* The prices in `.env.example` ($14.99 / $24.99 AUD) are commented examples — it is
   unclear whether they are decided.
2. **When does the allowlist open?** The whole access model (`ASSET_ACCESS_NORTH_STAR.md`) is designed
   for "open signup", and there is an access-code route, but no date or trigger is recorded.
3. **iOS: yes or no?** Explicitly listed as an open decision with a 6-month window from ~June 2026.
   The Capacitor shell, native push, and TestFlight checklist all exist unshipped.
4. **Which discipline is next after touring car?** The KB, the roll-centre pack, the universal
   parameters, and the tyre catalog are all touring-only. `CHASSIS_PLATFORMS` lists 13 platforms.
   *"Begin off-road / 8th scale"* is a 6-month outcome with no plan attached.
5. **What is the actual go-to-market?** The docs mention a *"potential Awesomatix team run at Worlds
   (~5 months)"* as a validation event and PetitRC as an aggregation source, but there is no
   acquisition, pricing-validation, or support plan in the repo.
6. **Who owns support and verification at scale?** The verified-flag model makes the founder the sole
   verifier by design (`/admin/review` exists "to keep this loop cheap"). At what user count does that
   break, and what is the fallback?
7. **What is the data-retention / export commitment?** `PRODUCT_NORTH_STAR.md` says *"Make export/
   continuity trustworthy"* and the moat is user data, but there is **no export feature** in the route
   list. `/privacy` and `/terms` pages exist — **UNVERIFIED:** I did not read their content.

## Technical

8. **Has the `verifiedAt` migration (and the newest `enrich_tiretype` one) been applied to
   production?** Both are recorded as written-but-not-deployed; production DB state cannot be inferred
   from the repo.
9. **Which branch is authoritative right now?** HEAD is `feat/tire-catalog-touring`; there are 9 local
   branches and 12 remote ones, including `wip/billing-admin-catalog` (billing lives there, not on
   main) and `feat/setup-sheet-groups` (built but uncommitted in a separate worktree, per the founder's
   own memory notes). A contributor cannot tell from the repo alone what is shippable.
10. **What is the intended fate of the parameter-effect catalog?** It is deliberately empty pending an
    A/B/C bench verdict (prose only vs + mechanism graph vs + enforced rails) that has not been run.
    Everything downstream of "Phase B infrastructure" is blocked on it.
11. **Is the Engineer's `light` tier still wanted?** It uses `gpt-4o-mini`, which sits uncomfortably
    beside the hard rule *"no cheap models on the advice path."* The light tier is scoped to non-advice
    lookups, but the boundary is a keyword classifier (`engineerChatContextTier.ts`) — how confident is
    that gate?
12. **What triggers an aggregation rebuild in production?** There is an endpoint but no cron, no
    post-write hook, and no staleness indicator visible to users.
13. **Does the Vercel cron secret exist in production?** `/api/cron/watch-results` returns 401 when
    `CRON_SECRET` is unset — i.e. the entire push-nudge feature is silently inert without it.
14. **Are there any non-founder users today, and how many?** The teams pilot is described as
    "two accounts". The AI budget defaults ($3/day, $25/month per user) imply an expected scale that
    is not stated.
15. **What happens to a user's data when a shared catalog row they created is merged by an admin?**
    `CatalogMergeControl` and `/api/admin/catalog-merge` exist; the reassignment semantics are not
    documented.
16. **Is `SetupSnapshot.data` ever schema-validated against the chassis's `schemaJson`?** I found
    normalisation (`normalizeSetupSnapshotForStorage`) but no validation that keys exist in the model
    schema. **UNVERIFIED.**
17. **What is the story for the PWM logger and the KiCad board?** Firmware, hardware, and a BLE parser
    exist with no app surface and a 12–24-month horizon. Is this a live project or parked?
18. **Motion / animation system** — is there one? See §7.3.

---

# 11. Glossary

## RC racing terms

| Term | Meaning |
|---|---|
| **RC** | Radio-controlled. Here specifically competitive 1/10-scale electric on-road racing |
| **Touring car / TC** | The main 1/10 four-wheel-drive on-road class this app targets. `ISTC` = International Standard Touring Car |
| **Chassis** | The car model/platform (Awesomatix A800RR, Mugen MTC3, Xray X4). In this app = `SetupSheetModel` |
| **Setup** | The complete adjustment state of a car — ~100 values |
| **Setup sheet** | The one-page PDF form manufacturers publish for recording a setup |
| **Kit setup** | The manufacturer's recommended baseline setup, as shipped |
| **Run / session** | One time the car goes on track, typically 5–8 minutes. The atomic unit of this app |
| **Heat** | One scheduled race session in a meeting |
| **Meeting / event** | A race weekend or practice day |
| **Practice / Seeding / Qualifying (Q1, Q2…) / Main (A-Main, B-Main)** | The session progression at a meeting. Mains are the finals; A-Main is the top one. "Legs" are multiple runnings of the same main |
| **LCQ** | Last Chance Qualifier — a bump race into the mains. Folded into QUALIFYING here |
| **Bump** | A race that promotes drivers up a main. Folded into QUALIFYING here |
| **Race class** | The competition category, e.g. "17.5 Stock", "Modified" — a motor/spec restriction |
| **Stock vs Modified** | 17.5-turn spec motor vs unrestricted — very different setup requirements |
| **Transponder** | The timing chip in the car that the track loop reads. Drivers may use a personal or a club/loaner chip |
| **Timing loop** | The wire under the start/finish line that reads transponders |
| **Out-lap / lap 0** | The standing-start first lap, excluded from all metrics |
| **Grip** | How much traction the track surface offers. Changes day to day and within a day |
| **Sugared track** | A track treated to raise grip, typical at big events |
| **Carpet vs asphalt** | The two indoor/outdoor surface types; they need very different setups |
| **Traction rolling** | The car trips over its outside wheels in high grip and flips — a limit/safety signal |
| **Understeer / push** | The front doesn't turn enough. Negative on the balance scale here |
| **Oversteer / loose** | The rear steps out. Positive on the balance scale here |
| **Corner phase** | Entry (turn-in) / mid (apex) / exit (on power). Balance is captured per phase |
| **Corner speed** | Slow vs fast corners — an axis orthogonal to phase |
| **Bite** | Initial grip. Grip curve peaks sooner, higher, narrower; precise but drops away sharply |
| **Hold** | Overall/sustained grip. Peaks later, lower, wider; forgiving plateau, lower ceiling |
| **"On the track" / "in the track"** | Higher RC + angled link (responsive, reactive) vs lower RC + flat link (smooth, rolled-in, mid-corner grip) |
| **Roll centre (RC)** | The geometric point about which the sprung mass rolls. Governs how fast load transfers |
| **Roll axis / rake** | The line between front and rear roll centres; rake = rear RC − front RC |
| **Camber** | Wheel lean from vertical. Negative camber = top leaning in |
| **Camber gain** | How camber changes as the suspension compresses (°/mm) |
| **Caster** | Steering-axis inclination in side view; affects steering feel and camber-on-lock |
| **Toe** | Wheels pointed in (toe-in) or out (toe-out) viewed from above |
| **Toe gain / bump steer** | How toe changes through suspension travel. "Bump-in" = toes in on compression |
| **Ackermann** | Steering geometry setting how much more the inside wheel turns than the outside |
| **Droop / downstop** | The limit on suspension extension. Different sheets use different conventions for the same thing — a documented aggregation hazard |
| **ARB / anti-roll bar / sway bar** | Resists body roll on one axle; a primary balance knob |
| **Damper / shock oil** | Silicone oil of a given viscosity in cSt. Thicker = more damping = less reactive |
| **Piston** | The perforated disc inside the damper; hole count/size shapes the damping curve |
| **Shim** | A thin washer used to raise or lower a suspension pickup point. The primary RC adjustment |
| **Upper inner / upper outer / under lower arm / under hub** | The four shim locations on each corner; each moves RC in a different direction (see §5.11) |
| **Bulkhead** | The chassis casting holding the inner suspension pickups |
| **FF / FR / RF / RR** | Front-forward, front-rearward, rear-forward, rear-rearward inner pickups. **Not** front-left/right |
| **Pickup split** | The FF−FR or RF−RR differential between forward and rearward inner mounts — sets anti-dive/anti-squat |
| **Anti-dive / anti-squat** | Side-view geometry resisting nose-dive under braking / squat under power |
| **Ride height** | Chassis height above the track |
| **Top deck** | The upper chassis plate; its screws and cuts tune chassis flex |
| **Diff / differential** | Front, centre, rear. Filled with silicone oil (in kcSt/"7k") to tune power delivery |
| **Belt tension** | Drivetrain adjustment on belt-driven touring cars |
| **Insert** | The foam ring inside a rubber tyre |
| **Premount** | A tyre pre-glued to a wheel |
| **Compound** | The rubber formulation, e.g. Sweep D32 — determines grip and wear |
| **Additive / tyre sauce** | Chemical applied to tyres before a run to soften them and raise grip |
| **Warmers** | Heated cups that pre-heat tyres before a run |
| **Towels** | A cloth between warmer cup and tyre, moderating heat transfer |
| **Tyre run number** | How many runs this physical set has done — the wear index |
| **Spec / controlled tyre** | A tyre a meeting mandates for everyone |
| **Mark** | The short code a driver writes on a tyre sidewall to tell sets apart |
| **Body shell** | The polycarbonate body; affects aero and weight |
| **ESC** | Electronic Speed Controller. "Drag brake" is its off-throttle braking setting |
| **Pinion / spur** | Gearing |
| **TITC** | Thailand International Touring Car — a major event; the app's background photo is from there |
| **Worlds** | The IFMAR World Championship |
| **VSUSP** | A well-known online suspension-geometry calculator, used to cross-validate this app's engine |
| **MoTeC** | A professional full-scale motorsport data-logging system — named as an explicit non-goal |

## Timing providers

| Name | What |
|---|---|
| **LiveRC** | Major RC race-results site. URL patterns `view_session`, `view_race_result`, `view_multi_main_result` |
| **MyLaps / Speedhive** | Global transponder timing platform + results portal. OAuth via Azure AD B2C |
| **MyRCM** | Another RC race-management/results platform (`myRcmParser`) |
| **PetitRC** | A community site publishing setup sheets; used as a setup-import source |
| **RCMart / EuroRC / AMain** | Retailers named as catalog pre-seed sources |

## JRC / code-internal names

| Name | Meaning |
|---|---|
| **JRC** | The brand. Package name is `rc-engineer`; domain `jrcdynamics.com`; bundle `com.rcengineer.app` |
| **The Engineer** | The LLM assistant feature |
| **engineerPhase5** | Internal folder name for the current Engineer implementation. Not product-facing |
| **Engineering brain** | The deterministic pre-LLM analysis (`engineeringBrain.ts`) |
| **Reasoning spine** | The structured route/lever grading layer (`reasoningSpine/`) |
| **Quick / normal / deep** | The three Engineer answer modes |
| **Quick fix** | The structured one-suggestion card surface |
| **Between-run hints** | Cached proactive suggestions keyed to a run |
| **Confidence ladder** | Decisive / Leaning / Genuinely open / Need input / No change — verbal only, never numeric |
| **Gold set** | The curated eval question set |
| **Calibrated judge** | The LLM scorer validated against founder ratings (r = 0.726) |
| **Tap-to-answer** | The `[[choices: A \| B \| C]]` chip mechanism |
| **positionBand** | `below_typical` \| `low` \| `mid` \| `high` \| `above_typical` — where a value sits vs the community |
| **gripTrendSignal** | The deterministic verdict object about how a parameter shifts across grip buckets |
| **Cliff's delta** | Non-parametric effect size in [−1,+1] used in `gripTrendSignal` |
| **Condition signature** | `g:LOW+MEDIUM_l:TECHNICAL_t:warm` — the aggregation bucket id |
| **Universal parameter** | A canonical cross-chassis parameter id (`droop_front`, `spring_rear`, …) |
| **`universal_touring`** | The pooled community bucket id for all eligible touring documents |
| **Setup sheet model** | The DB name for a chassis type |
| **Calibration** | A reusable PDF/image → field-key mapping profile |
| **Fingerprint** | pHash + anchor alignment used to auto-match an upload to a calibration |
| **AcroForm** | An editable PDF form; the anchor for template creation |
| **Marked contract** | The extraction rule that a choice field must declare a visible mark or return empty |
| **`verifiedAt` / `isAuthorized`** | The founder-approval flag on catalog rows / chassis types |
| **Wizard step ids** | `session`, `equipment` (labelled "Tires"), `prep`, `setup`, `laps`, `feel` (labelled "Feedback"). Ids are frozen because they ride in payloads |
| **`sortAt`** | The stable run-ordering column |
| **`loggingComplete`** | Draft vs finished run |
| **Locator ids** | `TrackSectorLine.lineKey` uses `sf` (start/finish) and `s1`, `s2`… for sectors |
| **`motTrackId`** | Multi-Object-Tracking id assigned by the Python video worker to one car |
| **`RCPW`** | Magic number `0x52435057` at the head of a PWM logger binary log |
| **Page-bg / glass-card / page-title / Eyebrow / StatTile** | The named CSS and component design-system hooks |
| **Tier A / B / C** | The visual-rework priority tiers for screens |
| **Pillar 1…8** | The founder's product stack rank (1 = lap ingestion, 2 = Engineer, 3 = Teams, …) |
| **North star doc** | The `docs/*_NORTH_STAR.md` spec format, each with a rollout status table |
| **Made-with:** | A commit-trailer convention noting which AI tool assisted |

---

## Appendix — where to look for what

| Question | File |
|---|---|
| What should the product become? | `docs/PRODUCT_NORTH_STAR.md` |
| How should the Engineer behave? | `docs/ENGINEER_NORTH_STAR.md` |
| How is Engineer quality measured? | `docs/ENGINEER_ITERATION.md`, `docs/ENGINEER_SUGGESTION_QUALITY_PLAN.md` |
| What should it look like? | `docs/VISUAL_NORTH_STAR.md` |
| Who can create/edit/verify what? | `docs/ASSET_ACCESS_NORTH_STAR.md` |
| Dashboard content and layout | `docs/DASHBOARD_NORTH_STAR.md` |
| Setup upload / OCR / calibration | `docs/SETUP_UPLOAD_NORTH_STAR.md` |
| Handling capture vocabulary | `docs/HANDLING_CAPTURE_NORTH_STAR.md` |
| Roll centre | `docs/ROLL_CENTER_NORTH_STAR.md` |
| Video | `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md`, `docs/VIDEO_TRACE_NORTH_STAR.md`, `docs/SECTOR_COMPARE_NORTH_STAR.md` |
| PWA / push / iOS | `docs/PWA_NORTH_STAR.md`, `docs/TESTFLIGHT.md` |
| Onboarding | `docs/ONBOARDING_NORTH_STAR.md` (read the 2026-07-23 reversal header first) |
| Teams | `docs/TEAMS_PILOT.md`, `docs/TEAMS_POST_PILOT_HARDENING.md` |
| **Is this feature real?** | `docs/NOT_YET_BUILT.md` |
| Agent rules, commands, hard rules | `AGENTS.md` |
| Deployment + env | `DEPLOYMENT.md`, `.env.example` |
