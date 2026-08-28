# APP_CONTEXT.md — the whole app, in one file

**Verified against the tree on 2026-08-18** (branch `main`, HEAD `a5caed2`, plus the uncommitted
work listed in §18). Where a number here disagrees with the code, **the code is right — fix the
line.**

**What this file is for.** `CLAUDE.md` is the short operating manual an agent reads before it
touches anything; the 32 files in `docs/` are the product specs. This file is the **map between
them** — everything that exists, what it does, and why it is shaped that way. Read it to get
oriented; read the matching north star in `docs/` before you change behaviour. It is also
self-contained enough to paste into a Claude project as background.

**Size of the thing:** 1,467 files under `src/` · 79 pages · 194 API routes · 58 Prisma models ·
87 migrations · 59 `src/lib` subsystems · 37 component folders · 201 test files · 193 npm scripts.

---

## 1. The product

An RC race-engineering app for competitive **1/10-scale radio-control racing** (touring car first,
off-road/8th-scale on the horizon). One sentence from `docs/PRODUCT_NORTH_STAR.md`:

> **Replace the race notebook** — help every RC driver log every run with almost no effort, review
> what worked, and get trustworthy setup guidance so they learn faster lap by lap.

**The core loop, which everything serves:**

```
Arrive at track
  → Log a run  (minimal taps; laps auto-link; setup + notes + ratings seamless)
  → Review the day  (what changed, what worked, pace vs competitors)
  → Ask the Engineer  (what to change between runs; reflection after the event)
  → Apply one change, log again
  → Repeat — every run, every meeting
```

**Founder's stack rank** (build in this order when unsure): 1. lap-time ingestion / session capture
· 2. Engineer AI · 3. teams · 4. community aggregations · 5. setup compare · 6. video analysis ·
7. garage & catalog · 8. iOS shell.

**Who it's for:** absolute beginner through world-class pro; solo drivers *and* teams (teams may
be the bigger strategic play — teammates learn from each other's working setups, and collation
across drivers narrows direction at a big meeting).

**The moat is accumulated context** — setup history, team knowledge, long-term patterns, Engineer
conversations tied to runs, community-relative signal. Losing the app should feel like losing a
notebook.

**Solo-founder product, live with paying users.** Production is not hypothetical. There is no CI —
the verification order in §4 is the only thing that catches a mistake.

---

## 2. The business

Locked by founder interview 2026-08-01 (`docs/MONETISATION_NORTH_STAR.md`), repriced 2026-08-06.

| | |
|---|---|
| **The door** | **Payment is the only way in.** No free tier, no open signup, no trial. A full-data read-only **demo** does the selling. |
| **Tiers** | **Notebook** AUD $9.99/mo ($99.90/yr) · **Race Engineer** AUD $19.99/mo ($199.90/yr) |
| **Engineer caps** | Notebook 1 question/day · Race Engineer 100/month pool. The pitch is **burst**, not volume. |
| **Pro-only features** | Video analysis + roll-centre lab. Visible-but-locked to Notebook — the only upsell channel that exists without a free tier. |
| **Refunds** | 14-day money-back, stated at checkout. |
| **Testers/comps** | 100%-off promo codes through the same checkout. **Not** grandfathering. |
| **Measured cost** | US$0.048 blended per Engineer answer (US$0.097 uncached), from real prod `AiUsageDaily`. |

**Tier ids are `standard` / `pro` forever.** Only the *labels* moved (`TIER_LABELS` in
`src/lib/brand/brandNames.ts`). `Subscription.tier` is a plain string and anything that isn't
exactly `"pro"` resolves to `standard` — renaming the stored values would risk silently demoting a
payer.

**Names:** product = **JRC Trackside** (provisional), company = **JRC Dynamics**, domain =
`jrcdynamics.com`, production = `https://www.jrcdynamics.com`. Every user-visible name is a
constant in `src/lib/brand/brandNames.ts` — **six files can't import it** and carry the literal
(`public/sw.js`, `public/offline.html`, `public/landing/index.html`, `scripts/og-card/card.html`,
`capacitor.config.ts`, `ios/App/App/Info.plist`). Grep those on a rename.

---

## 3. Stack, hosting, shells

- **Next.js 16 App Router + React 19 + TypeScript**, Tailwind v4 (semantic tokens in
  `src/app/globals.css`).
- **Prisma + PostgreSQL on Neon.** Production branch `ep-hidden-rice`; `.env.local` points at the
  **scratch-dev** branch `ep-muddy-unit` (a copy-on-write clone — it holds real users' rows,
  isolated but **not anonymised**). Grep the host before running any `db:*` script; the filename
  tells you nothing.
- **Vercel**, region `syd1` (`vercel.json`). Pushing `main` deploys production.
- **PWA** — `public/sw.js`, `public/offline.html`, install prompt, web push (VAPID).
- **iOS Capacitor shell** — `ios/`, `capacitor.config.ts`, `capacitor-www/`, native APNs push,
  deep-link bridge. `npm run cap:sync` / `cap:open`. See `docs/TESTFLIGHT.md`.
- **Hardware side-project (dormant):** `firmware/rc-pwm-logger`, `hardware/rc-pwm-carrier`,
  `src/lib/rcPwmLogger/bleProtocol.ts` — a PWM data logger. Explicitly gated behind "don't start
  platform bets until logging and Engineer trust are solid".
- **Native deps that do not bundle:** `onnxruntime-node` (local PP-OCR), `@napi-rs/canvas`,
  `pdf-to-img`, `pdfjs-dist` — all in `serverExternalPackages`, with everything they load *by
  runtime path* enumerated in `outputFileTracingIncludes` in `next.config.mjs`. Three production
  outages so far came from a file the tracer couldn't see.
- **The landing page is not React.** `/welcome` is rewritten (`beforeFiles`) to the static
  `public/landing/index.html` — a Claude Design artifact served verbatim. Its prices are literals;
  if a price moves it moves in Stripe **and** in that HTML.

---

## 4. Commands

```
npx tsc --noEmit          # typecheck — the first gate
npm run lint              # eslint
npm run dev               # dev server
npx next build            # LOCAL production build
```

- **`npm run build` is the Vercel pipeline**, not a local build — it runs `scripts/vercel-build.cjs`,
  which does `prisma migrate deploy` first. Denied at the harness level. Local build is
  `npx next build`.
- **No test runner.** No Jest, no Vitest. Tests are plain `node:test` or bare `tsx` scripts —
  **114 `test:*` npm scripts**, one per area. Run the one matching what you changed;
  `grep test: package.json` to find it.
- **One test file directly:** `npx tsx --test path/to/x.test.ts`. Anything importing a
  `server-only` module needs `node --conditions=react-server --import tsx path/to/x.test.ts` —
  that's why the scripts look inconsistent. Copy the invocation from the nearest existing script.
- **E2E:** Playwright (`npm run test:e2e`), 30 specs in `e2e/`, `--project=mobile-chromium` is the
  usual target. The account is re-minted every run: seed after `--project=setup`, then `--no-deps`.
- **`db:*` scripts (13) point at whatever `.env.local` points at** — 12 of 13 hardcode
  `dotenv-cli -e .env.local`, so reaching a real database is the default, not an opt-in. Drift
  repair is `npm run db:migrate:reconcile` or `prisma migrate resolve` — **never `db push`**. Use
  `DATABASE_URL_UNPOOLED` for `prisma migrate`; the pooler throws P1002 lock timeouts.
- **Slow and costly, only when asked:** `engineer:eval`, `engineer:bench*` (22 engineer scripts),
  `setup-extract:eval` (8 scripts).
- **Screenshot / probe helpers:** `npm run shots:desktop`, `npm run layout:probe --width=390`,
  `share:shots`, `demo:seed`, `demo:timing:setup`.

**Verification order before calling something done:**
`npx tsc --noEmit` → the matching `test:*` → `npx next build`. Nothing else will catch it.

**And drive the app.** Founder call 2026-08-11, reversing the older "never drive it" rule: start
the dev server, click the flow, take screenshots. A route that typechecks, builds, and 500s only
on Vercel is invisible to `tsc`. Use a LAN IP listed in `allowedDevOrigins`
(`192.168.1.112`, `192.168.50.248`, `192.168.50.91`) or the page renders and **nothing is
clickable** (Next 16 blocks cross-origin `/_next/*` dev requests and hydration dies silently).

---

## 5. Guards you will meet

Safety lives in `.claude/settings.json` + `.claude/hooks/`, not in prose. Hooks fire *below* the
permission layer, so they prompt even under `bypassPermissions`.

| Hook | What it does |
|---|---|
| `prod-guard.cjs` | Any production-DB or deploy-pipeline command raises a prompt. |
| `kb-guard.cjs` | Writes to `content/vehicle-dynamics/*.md` (top level) raise a prompt — that prose is quoted verbatim to paying drivers as ground truth. Drafts under `drafts/` are open. The `audit-kb` skill carries the real rules. |
| `uncommitted-guard.cjs` | End-of-turn warning listing dirty worktrees. |
| `guard-test.cjs` | Present but **registered nowhere** — does nothing. |

Also: pushing to a git remote always prompts (global hook), and **`main` deploys production on
push**. Jordan runs several sessions in parallel — **check `git branch --show-current` before
committing**, another session may have moved HEAD.

Hard-denied outright: `npm run build`, `db:push`, `db:seed`, `db:migrate:deploy`, and destructive
`neonctl` verbs.

---

## 6. Request path, auth, entitlement

**Edge → middleware.** `src/middleware.ts` runs on the edge using the Prisma-free
`src/auth.config.ts`. It gates everything except: `/login/*`, `/privacy`, `/terms`,
`/api/health/*`, `/api/_debug/version`, `/api/stripe/webhook`, `/join/*`,
`/api/billing/public-checkout`, `/welcome`, `/landing/*`, `/demo`. Unauthenticated APIs get
**401 JSON**; unauthenticated pages redirect to `/login?from=…`, except `/` which redirects to
`/welcome` (a stranger gets the pitch, not a sign-in form).

**Demo mode is enforced here too.** One chokepoint refuses every mutating request from the shared
demo session (403), with a deliberately tiny allowlist — `/api/engineer/chat` only, because the
Engineer *is* the demo.

**Node → the real auth config.** `src/auth.ts` holds NextAuth v5: magic-link email (Nodemailer) +
optional Google, with a **sign-in allowlist** (`AuthAllowedEmail` table + `AUTH_ALLOWED_EMAILS`).
Since 2026-08-15 the email leads with a **6-digit sign-in code** beside the link, so opening the
link in the wrong browser can't strand you (`src/lib/auth/signInCode.ts`, `SignInCode` model —
deliberately *not* a `VerificationToken`).

- Pages call `requireCurrentUser()`; routes call `getAuthenticatedApiUser()`
  (`src/lib/currentUser.ts`).
- **Entitlement is always derived server-side** in `src/lib/entitlement.ts` from the Stripe
  webhook's `Subscription` row — never trusted from a client. Pure logic (tiers, features, grace)
  is split into `entitlementLogic.ts` so it unit-tests without a DB; the redirect guards are in
  `entitlementGuards.ts`.
- Features: `logging`, `review`, `compare`, `engineer` (Standard+) · `video`, `roll-center` (Pro).
  The Engineer is on **both** tiers — the difference is a usage cap, not a feature gate.
- `BILLING_ENFORCED=1` is the master switch. Off ⇒ every authenticated user resolves to full Pro.
- 3-day **grace window** after `currentPeriodEnd` so a delayed renewal webhook can't lock a payer
  out mid-race-weekend.
- **Grandfathering is admin-emails only** since 2026-08-01. An `AuthAllowedEmail` row grants
  sign-in, never entitlement.
- **Per-user AI spend ledger:** `AiUsageDaily` + `src/lib/aiUsage/budgets.ts`. The in-memory
  `checkApiRateLimit` is a burst brake only (its real ceiling on Vercel is limit × instance count);
  this table is the durable cap.

---

## 7. The data model (58 models, 13 enums, 87 migrations)

`prisma/schema.prisma` is heavily commented and is the authority. Grouped:

**Identity, billing, spend (9)** — `User`, `Account`, `Session`, `VerificationToken`, `SignInCode`,
`AuthAllowedEmail`, `Subscription`, `StripeWebhookEvent`, `AiUsageDaily`.

**Teams (4)** — `Team`, `TeamInvite`, `TeamMembership`, `TeamRunComment`.

**Garage & catalog (11)** — `Car`, `Track`, `TrackLayout`, `TrackLocationRunPromptDismissal`,
`FavouriteTrack`, `Event`, `EventParticipation`, `AdditiveType`, `TireType`, `TireSet`, `Battery`.

**Setup system (13)** — `SetupSheetModel` (a chassis; **global**, shared by everyone racing that
model), `SetupSheetBlank` (a blank PDF edition of a sheet), `SetupSheetCalibration` (maps one PDF
layout onto field keys), `SetupDocument` (an uploaded file), `SetupSnapshot` (the values),
`BaselineSetup`, `SetupFillDraft`, `SetupImportBatch`, `SetupSheetManufacturerBaseline`,
`SetupSheetCatalogSuppression`, `SetupParameterAggregation`,
`CommunitySetupParameterAggregation`, `ChassisTypeRequest`.

**Runs & laps (6)** — `Run`, `ActionItem`, `ImportedLapTimeSession`, `RunImportedLapSet`,
`RunImportedLap`, `WatchedLapSource`.

**Engineer (6)** — `EngineerChatThread`, `EngineerChatMessage`, `EngineerMessageRating`,
`EngineerBetweenRunHint`, `EngineerDashboardSuggestion`, `EngineerGoldSetCandidate`.

**Video (4)** — `VideoAsset`, `VideoAnalysisJob`, `TrackCameraProfile`, `TrackSectorLine`.

**Platform (5)** — `AppSetting`, `PushSubscription`, `NativePushDevice`, `PerfSample`,
`PerfClientMetric`.

**Enums (13)** — `SessionType` (TESTING · PRACTICE · RACE_MEETING), `TrackDirection` (CW/CCW),
`ActionItemSourceType`, `ActionItemListKind`, `BaselineSetupKind`, `SetupDocumentSourceType`,
`SetupDocumentParseStatus`, `SetupDocumentImportStatus`, `SetupDocumentImportOutcome`,
`SetupAggregationScopeType`, `SetupAggregationValueType`, `SetupImportDatasetReviewStatus`,
`VideoAnalysisJobStatus`.

### `Run` — the atomic unit of the whole product

A run is **one 5–8 minute on-track session**. It is the biggest model in the schema. What hangs
off it:

- **Required `SetupSnapshot`** — every run has one; there is no such thing as a run without a
  setup.
- Car, track, track layout, direction, event, race class.
- **Tires:** compound (`tireTypeId`), `tireRunNumber` (runs on this rubber), `tireStintId` (one
  continuous life of rubber), `tireAgeKnown`, additive, and `tirePrep` (an ordered sequence of
  applications: additive, minutes, warmers, towels, temperature).
- **Laps:** `lapTimes` (raw JSON array, self), `lapSession` (structured, multi-driver/field-ready),
  plus materialised `bestLapSeconds` / `avgTop5LapSeconds`.
- **Feel:** `notes`, `handlingAssessmentJson` (structured tags/balance), `carRating` (required 1–10
  at Run complete — drives the Engineer's `runQuality` signal), `suggestedChanges`,
  `suggestedPreRun`, `appliedChanges`.
- **Conditions:** auto-fetched from Open-Meteo at the session's actual time against the track's
  pinned coordinates, then user-editable. Canonical metric. `conditionsTrackTempC` is a **manual
  probe reading only**, never from the API.
- **Setup PDF provenance:** source document + calibration + rendered path + render version.
- **Cached Engineer summary** (`engineerSummaryJson`) and deep dive.

**Three timestamps, deliberately not collapsed:**

| Field | Means |
|---|---|
| `createdAt` | the row was written |
| `sessionCompletedAt` | the car was actually on track (from timing import, UTC) |
| `sortAt` | stamped once at create — the **stable ordering axis**, so re-imports never reshuffle a day |

Plus `loggingCompletedAt` (when the driver finished logging) and `localTimeZone` (the IANA zone of
the device that logged it — session grouping asks "what day was this *to the driver*", not to
whoever is reading; without it a teammate's test day splits in two across the reader's midnight).

**Dormant columns kept on purpose:** `gripLevel` (nothing writes it — the capture control was
pulled; `resolveGripTags` falls back to `Track.gripTags`), `tireSetId` (superseded by the
run-counter model), `Car.carClass`.

### Materialised data — caches with their own staleness

`Run.bestLapSeconds` / `avgTop5LapSeconds`, the aggregations in `src/lib/setupAggregations/`, and
the setup-sheet page images are **all caches**. After a change affecting stats, rebuild via
`POST /api/setup-aggregations/rebuild` or the numbers go quietly wrong. Request-level caching is
`src/lib/cachedReads.ts` (`unstable_cache`, 30s, tagged) + `revalidateUser.ts`.
**Bump the cache key version whenever a cached model gains a field** — a stale entry renders a
broken page for every warm user until the window rolls.

---

## 8. Surfaces (79 pages)

### The shell

- **Mobile dock — 4 cells:** Dashboard · Analysis · Engineer · **Paddock**, plus the yellow
  Log-run circle (`LogRunFab`) and Settings behind the account avatar. Cell count is a **budget**:
  at 390px four cells are 75px each; a fifth costs ~15px off every one. Put a new destination
  *inside* one of the four.
- **Desktop top rail — 5 tabs:** Dashboard · Analysis (→ `/runs/history`, the Sessions workbench)
  · Engineer · Paddock · Tools, with Log-run and the gear in a right-hand utility cluster.
- **Ideas edge tab** — a floating notes drawer pinned at `--ideas-tab-y: 42svh`, with a
  dashboard-only 5s nudge until first open.
- Active tab is **longest-prefix** scored (`resolveActiveNavId`), and `tools` folds to `analysis`
  on mobile.
- Chrome-free routes: `/login/*`, `/privacy`, `/welcome`, `/join/*`, `/demo`.

### Daily loop

| Route | What it is |
|---|---|
| `/` | Dashboard — day verdict, summary, last-run read, next outing, action items, detected-session prompts, watched sources, get-set-up card. Desktop is a 3-column grid with the hero spanning two. |
| `/runs/new` | **The log-run wizard** — the biggest surface in the app (`NewRunForm.tsx`, ~5,970 lines). |
| `/runs/[id]`, `/runs/[id]/edit` | One run: laps, setup sheet, compare, field, notes. |
| `/runs/history` | Sessions browser / workbench — filters, groups, trend, compare. |
| `/analysis`, `/analysis/roll-center` | Analysis hub; the Geometry (roll-centre) Lab. |
| `/engineer` | The Engineer — chat + history (two cards since 2026-08-18). |
| `/paddock` | Cars, tracks and meetings in one place (replaced `/more`, `/assets`, the Events tab). |

### Paddock & catalog

`/cars`, `/cars/[carId]` (+ `/setups/new`, `/setups/[setupId]`, `/edit`, `/baselines/[id]`,
`/grip-archetypes`), `/tracks`, `/tracks/[trackId]`, `/events`, `/events/[eventId]`, `/tires`,
`/additives`, `/garage`, `/assets`.

### Setup pipeline

`/setup`, `/setup/[carId]`, `/setup/[carId]/[setupId]`, `/setup/comparison`, `/setup/admin`,
`/setup/aggregations-debug`, `/setup/bulk-import/*`, `/setup-documents`, `/setup-documents/[id]`,
`/setup-documents/[id]/calibrate-image`, `/setup-calibrations`, `/setup-calibrations/[id]`,
`/setup-sheet-models`, `/setup-sheet-models/new`, `/setup-sheet-models/[id]`, and its baseline
editors.

### Video, tools, teams

`/videos`, `/videos/analysis`, `/videos/analysis/jobs/new`, `/videos/analysis/jobs/[jobId]`,
`/videos/analysis/manual/new`, `/videos/overlay`, `/tools`, `/teams`, `/teams/[teamId]`,
`/teams/[teamId]/settings`.

### Doors, account, admin, debug

`/welcome` (static landing), `/join`, `/join/success`, `/demo`, `/login`,
`/login/verify-request`, `/billing`, `/settings` (one page of plain rows since 2026-08-18),
`/privacy`, `/terms`, `/admin/perf`, `/admin/review`, and 12 `/debug/*` preview pages that render
a surface from fixtures without a database (`onboarding-preview`, `sheet-fill`, `lap-compare`,
`day-verdict`, `team-focus`, `session-trend`, `roll-center-strip`, `handling-panel`, `demo-tour`,
`analyze-flow`, `lap-times`, `video-decode-test`).

---

## 9. API surface (194 routes)

Grouped by what they serve:

- **Runs & laps (~35)** — CRUD, `runs/catalog`, `for-picker`, `for-setup-compare`, `search`,
  `by-ids`, `last*`, `today-draft`, `pattern-digest`, `backfill-lap-summary`, per-run
  `setup-snapshot`, `sheet-boxes`, `setup-pdf`, `race-field`, `imported-lap-sets`,
  `engineer-summary`, `engineer-deep-dive`, `reorder`, the two dismiss endpoints.
- **Lap import & watch (~12)** — `lap-time-sessions*`, `laps/parse-url-preview`,
  `laps/discover-sessions`, `laps/scan-day-url`, `laps/extract-preview`, `lap-watch/check`,
  `lap-watch/sources*`, `cron/watch-results`, `events/detect-live-rc-meeting`.
- **Setup (~45)** — the largest family: `setup-documents/*` (upload, process, reparse, calibrate,
  create-setup, pdf-form-fields, detect-image-regions, bulk-import-parse),
  `setup-sheet-models/*` (blank, sheet-page, sheet-plan, baselines, parameter-usage),
  `setup-calibrations/*`, `setup-snapshots/*`, `setup-aggregations/*`, `setup-import-batches/*`,
  `setup/interpret-changes`, `setup/options`, `baseline-setups/[id]`, `setup-fill-drafts`.
- **Engineer (~14)** — `engineer/chat`, `threads*`, `quick-fix`, `between-run-hints`,
  `dashboard-suggestions`, `summary`, `run-slice`, `compare-options`, `anchor-candidates`,
  `pace-vs-field-digest`, `messages/[id]/rating`, plus `admin/engineer-*` (gold set, ratings,
  lab, feedback export).
- **Catalog (~25)** — cars, tracks (+ layouts, camera-profiles, favourite, location prompt),
  events (+ join, my-race-sessions), tire-types, additive-types, teammates, teams (+ members,
  invites, feed, comments).
- **Auth & billing (~12)** — `auth/[...nextauth]`, `verify-code`, `redeem-access-code`, `demo`,
  `dev-new-user`, `account`, `logout`, `config-hint`; `billing/checkout`, `portal`,
  `public-checkout`, `stripe/webhook`.
- **Platform (~20)** — `push/*` (web + native), `perf/beacon`, `weather`, `me/time-zone`,
  `profile-image`, `onboarding`, `new-run/bootstrap`, `video-analysis/*`, `videos/*`,
  `settings/*`, `mylaps/*` (OAuth connect/callback/link), `health/openai`, `_debug/*`,
  `action-items*`, `dev-markup`.

---

## 10. The four load-bearing subsystems

### 10.1 Runs — logging

**The wizard is six steps** (`src/lib/runs/wizardWalk.ts`):

| id | label | when |
|---|---|---|
| `session` | Session | pre-run (car + day type + event/track) |
| `equipment` | **Tires** | pre-run |
| `prep` | Prep | pre-run |
| `setup` | Setup | pre-run |
| `laps` | Laps | after-run |
| `feel` | **Feedback** | after-run |

Ids never change (they ride in payloads and jump targets) — only labels have. **Every run walks
every step**; "continue from last run" *prefills* the steps rather than skipping them.

Founder rules baked in: **prefill is always an option, never automatic** (the wizard always lands
blank and offers the last run as a card); there is no staleness cutoff — an old run is still
offered, honestly dated; the "Run completed?" interstitial is retired (tabs are the nav, end-of-step
rows carry the walk-away moment); with no cars it refuses to mount and says why.

Supporting logic: `logRunSession`, `autoCopyResolver`, `carSwap`, `setupSourceDefault`,
`tirePrep`, `classifySession`, `runHistoryFilters` (1,022 lines), `sessionWorkbenchModel`,
`buildRunHistoryGroups`, `teamDayModel`.

Read `docs/HANDLING_CAPTURE_NORTH_STAR.md` before touching ratings/handling capture, and
`docs/ONBOARDING_NORTH_STAR.md` for first-run behaviour.

### 10.2 Lap import — `src/lib/lapUrlParsers/`, `lapImport/`, `lapWatch/`

**Parsers, tried in order** (`registry.ts`): LiveRC → Speedhive-practice → Speedhive →
generic HTTP timing → stub. Each turns a URL into an `ImportedLapTimeSession` holding a
`parsedPayload` (laps, session drivers, hints) and `fieldStatsJson` (per-driver best / avgTop5 /
avgTop10, median field pace, ranks).

- **`fetchText.ts` is the single fetch choke point** for every parser and every discovery/watch
  crawl. SSRF safety is `src/lib/http/timingUrlSafety.ts`.
- 🚫 **MyRCM was switched off on 2026-08-26.** Two sources remain: LiveRC and MyLaps/Speedhive.
  MyRCM publishes no API, and its operator has stated that reading its pages is not permitted
  (relayed via a TestLogger statement to Jordan), so HTML scraping was the only door and it is now
  closed. **The gate is `BLOCKED_TIMING_HOST_SUFFIXES` in `http/timingUrlSafetySync.ts`, not the
  parser registry** — removing `myRcmParser` alone is not enough, because `httpTimingParser`
  matches any http(s) URL and an admin request carries `allowAnyPublicHost`, which waves every
  public host through. Measured on the dev server before the denylist existed: an admin paste of a
  MyRCM report URL still fetched the page and imported four bogus "laps". The denylist outranks
  both. Removed with it: the class-page session picker, `Settings → Name on MyRCM` and its route,
  `getMyRcmDriverNamesForUser`, the scan-day-url MyRCM branch, and `scripts/myrcm-live-check.ts`
  (a canary that hit myrcm.ch on demand). Left in place, dormant and unreachable: `myRcmParser.ts`,
  `myRcmReport.ts`, `myRcmUrl.ts`, `discoverMyRcmDaySessions.ts` and `npm run test:myrcm` (fixture-
  only, no network), so the work is recoverable in one line if consent ever arrives. Already
  imported MyRCM runs still render — `lapImport/labels.ts` keeps the `myrcm` timing source and its
  wall-clock-as-UTC rule, and the ingest panel's source rail still offers a MyRCM segment for old
  rows.
- **Discovery:** `discoverLiveRcSessionsForUser`, `discoverTrackTimingSessions`,
  `discoverSpeedhive*`, `expandLiveRcEventHub`, `detectActiveRaceMeetingAtTrack`. Driver identity
  matching is name-normalisation (`liveRcNameNormalize`, `speedhiveDriverNames`) plus Speedhive
  transponder ids.
- **Reading an import — `/laps/analysis`** (2026-08-27). Lap analysis used to require being the
  driver who logged the run: the sheet anchored on a `Run`, so a race you watched had nowhere to
  be read. `loadImportedSessionAnchor` dresses an `ImportedLapTimeSession` as the shape the sheet
  anchors on (`import:<id>`, every entrant as an `importedLapSet`), so the SAME
  `LapComparisonColumnGrid` opens on a session with no run behind it. One route, three states:
  `?session=` an import, `?run=` your own run full-page (the pop-up's "Detailed analysis" door,
  carrying `?target=`/`?columns=`), neither = the library. `/laps/import` redirects here; the old
  JSON-dump bench is gone. Importing a foreign meeting always worked — every parser stores the
  whole field — so this was a reading surface, not a pipeline.
- **Known competitors** — `AppSetting.knownCompetitorsJson`, other people's transponders.
  MYLAPS' practice API serves any chip unauthenticated, so
  `discoverSpeedhivePracticeSessionsForChip` is the user-scoped walk with the identity as an
  argument. ⚠️ **Pulled only when asked** (founder call): nothing schedules it.
- **MyLaps OAuth** (`src/lib/mylaps/`) links a real Speedhive account with PKCE.
- **Watching:** `WatchedLapSource` rows are polled by `/api/cron/watch-results` to push a
  "new run detected" nudge. ⚠️ **The cron was dropped in `f1991af` and has never fired in
  production** — 0 of 19 users have ever been notified. Lap import is effectively pull-only today.
- **Merging:** a run can carry **two timing imports** — laps join at save, rivals join on read
  (`mergeImportedLapSets`, `RunImportedLapSet`/`RunImportedLap`). No schema change was needed.
- `autoExcludeOutlierLaps` drops obvious junk laps; `computeImportedSessionFieldStats` builds the
  field sheet.

**Delta sign convention:** lap deltas are `cell − anchor`, so **positive = slower**. Pace vs field
is `user − field`, so **negative = faster than the field**.

### 10.3 Setup sheets — `setupDocuments/`, `setupSheetModels/`, `setupCalibrations/`, `setup/`

The mental model:

```
SetupSheetModel  = a chassis (global, shared by everyone racing that model)
SetupSheetBlank  = one blank PDF edition of that chassis's sheet (1 chassis : many editions)
SetupSheetCalibration = maps ONE PDF layout onto field keys
SetupDocument    = a file someone uploaded
SetupSnapshot    = the actual values (per-run, or a named library setup)
```

**Locked decisions (read `docs/SETUP_UPLOAD_NORTH_STAR.md` before changing any of this):**

- **The driver fills boxes over a server-rendered picture of the page** — never a client-side PDF
  engine.
- **Images and flat/scanned PDFs are refused at the door**, by design. Reading a sheet ≠ the
  Engineer understanding it. This decision was made twice and lost twice.
- **Template creation is AcroForm-anchored and hand-built, box-first.** The AI *naming* pass was
  deleted — the founder renamed every drafted parameter, so the draft cost more than it saved.
  `/setup-sheet-models/new` takes a name + the blank PDF, creates an empty schema, and lands in
  the mapping editor where every parameter is created by clicking its box.
- **Positions are siblings, not groups.** `Camber` + Front/Rear creates `camber_front` **and**
  `camber_rear`. Grouped (`one_of_many` / `many_of_many`) means "these boxes are one parameter's
  options".
- **A rebuilt PDF of a known sheet silently becomes an *edition* of the same chassis** at upload
  (`sheetBlankResolve`), rather than a new chassis.
- **Trust model:** high-confidence fields import directly; the review screen opens focused on
  flagged fields only, with an evidence crop of the source pixels. A wrong value presented as
  confident is the only real failure. Ship bar: ≥95% correct-or-flagged.
- The **geometry strip** (roll centre etc.) is rebuilt on both the read and fill surfaces and must
  never grow into the Lab.
- Sign convention: geometry values are **unsigned on paper** (`geometrySignNormalize`).

Extraction plumbing: `pdfFormFields` (AcroForm), `pdfServerRaster` (page pictures via
`pdf-to-img`/`@napi-rs/canvas`), `localOcr` (PP-OCR via `onnxruntime-node`),
`setupExtractAi/` (vision fallback for uncalibrated one-offs only), `fillPdfForm` +
`pdfFieldAppearance` (writing a filled sheet back out), `zapfDingbatMarks` (tick boxes).

**Aggregations:** `setupAggregations/` rolls snapshots (read **through runs**, so library setups
can never enter the community pool) into `SetupParameterAggregation` (per user/car) and
`CommunitySetupParameterAggregation`, bucketed by track condition signature + temperature band.

### 10.4 The Engineer — `src/lib/engineerChat/` + `src/lib/engineerPhase5/`

**Rebuilt from scratch 2026-08-13.** Read `docs/ENGINEER_NORTH_STAR.md` first, always.

- **`engineerChat/` is the current chat path (v0, 2026-08-05) and is five files**: the KB, a short
  system prompt, the OpenAI client, the turn runner, and a lab.
- **v0 deliberately runs on less than it used to.** The pipeline it replaced sent ~99K chars a
  turn (KB + a 32K context JSON + seven tool schemas + a reasoning-spine block). Much of it had
  quietly stopped running. The founder's call: restart from the least that could possibly work and
  add back one rung at a time, each earning its place. The current prompt won a blind 5–0 ablation
  against a 67K-char rulebook.
- **The prompt's load-bearing sentence is "you cannot see their logged data."** The app still lets
  a driver pin a run before asking, so questions arrive phrased as if the numbers were attached —
  without that sentence the model invents setup values. There is a second prompt variant used only
  when the lab attaches fact blocks.
- **The KB is sent in full, every turn** — every file, full prose, nothing retrieved. Header rules:
  never name the files to the driver; the files store **mechanisms, not outcomes**; where two
  files push opposite ways, hold both and say what decides it.
- **Models:** chat is **`gpt-5.6-terra`** at temperature 0.3, reasoning effort medium (won a blind
  pairwise 3-1-1 against gpt-5.5 at $0.055 vs $0.145 and p50 11s vs 21s). The three non-chat
  features (between-run hints, dashboard suggestions, quick-fix) call
  `/v1/chat/completions` directly and stay on **`gpt-5.5`** — OpenAI hard-400s gpt-5.6 there when
  tools are attached. The two are easily confused; they are not the same constant.
- **`engineerPhase5/` is the older, larger home** (historical name, not product-facing) and still
  owns: KB retrieval, run/context builders, comparable-run scoring, anchors, quick-fix,
  between-run hints, pattern digest, pace-vs-field, parameter effects, tire-life priors,
  setup-outcome memory.
- **The order of the payload is load-bearing.**
- **Quality loop:** `EngineerMessageRating` (in-app stars) → `engineerFeedback/` (failure taxonomy,
  calibrated judge, grounding divergence, gold-set candidates) → `engineer:eval` /
  `engineer:bench*` / `engineer:grader:*`. See `docs/ENGINEER_ITERATION.md` and
  `docs/ENGINEER_SUGGESTION_QUALITY_PLAN.md`.

**The knowledge base** — `content/vehicle-dynamics/`, 22 curated files + 2 drafts + a `concepts/`
index. Covers camber, caster, toe, ARB, springs, damper oil, shock geometry, ride height & rake,
droop/downstop, anti-dive/anti-squat, diff & driveline, chassis flex, upper-link geometry,
under-hub, under-lower-arm, steering geometry/Ackermann, servo horn, bodyshell aero, weight
distribution, bump steer, and the Awesomatix spring-gap damper. Jordan's bar for a claim:
**"physics that cannot be argued."** The `audit-kb` skill carries the rules; `kb-guard.cjs`
enforces them.

**Standing findings worth knowing:** damper leads 9/12 answers *not* because of recency — Jordan
is permanently far from the community median, so that gap carries no per-question information.
Attention signals are backward-looking: "far from median" and "recently changed" only fire on
levers he already moves (bump steer sat at 2.5 for 60 runs and was invisible). **Audit by dumping
a real context, never by reading source** — source shows what the Engineer *reads*, never which
input *wins*.

---

## 11. The rest of `src/lib` (59 folders, 99 top-level files)

| Area | Modules |
|---|---|
| **Dashboard** | `dashboardServer` (1,290 lines), `dashboardSummary`, `dashboardVerdict`, `dashboardRecords`, `dashboardHeroSeries`, `cachedReads`, `revalidateUser`, `cacheTags` |
| **Paddock** | `paddock/loadPaddockModel`, `paddockModel` *(new)* |
| **Analysis** | `analysis/analysisHomeModel`, `lapAnalysis`, `lapCompareScope`, `lapMistakes`, `runCompareCatalog/Meta/Shape` |
| **Events** | `events/` — season timeline, cadence, access, participation, LiveRC event resolution, merge/dedupe |
| **Tracks** | `tracks/` — access, catalog scope + dominance, timing URL, legacy snapshot; `location/` proximity + coordinate paste |
| **Cars / tires / additives** | `cars/` (name, discipline, class, platform, recent-use order), `tires/` (stint derivation, run-number cascade, age readout, prep fields, matching), `additives/` |
| **Setup helpers** | `setup/` (fill order, fill drafts, save context/mode/name, PDF render, derived fields, history, screw + numeric normalisation), `setupCompare/`, `setupComparison/`, `setupCalculations/` (spring-rate lookup, A800RR derived), `setupDiff`, `setupFieldCatalog` |
| **Roll centre** | `rollCenter/` — `engine`, `vsusp`, `computeFromSnapshot`, `labState`, `packs`. See `docs/ROLL_CENTER_NORTH_STAR.md` |
| **Video** | `videoAnalysis/` (sector stats, lap compare, transponder compare, export worker), `manualVideoAnalysis/` (sync, sectors, timing, prediction), `videos/storage` |
| **Teams** | `teams/` — invite rules, comment rules, feed model, member display, run access, notifications |
| **Sharing** | `share/` — satori-rendered run cards and setup images to PNG, straight to the OS share sheet. ⚠️ satori turns fragments into rows; iOS Capacitor file-share is still gated |
| **Auth extras** | `auth/` — magic-link email, sign-in code, dev session cookie, signup access code |
| **Billing** | `billing/paidSignup`, `stripe`, `stripeSubscriptionSync` |
| **Demo** | `demo/` — access rules, anonymisation, tour steps, season facts |
| **Onboarding** | `onboarding/visibility` (pure state machine, no stored step counter), `timingIdentity`, `server` |
| **Weather** | `weather/` — Open-Meteo forecast + archive, temperature bands, conditions record |
| **Push** | `webPush/` (VAPID), `nativePush/` (APNs), `pwa/` |
| **Perf** | `perf/` — route keys, server timing, Prisma extension, client beacon, `PerfSample`/`PerfClientMetric`, `/admin/perf`. See `docs/PERFORMANCE.md` |
| **Misc** | `search/optionSearch`, `assets/` (catalog access + usage), `account/` (deletion, throwaway accounts), `profileImage/`, `legal/`, `theme/appTheme`, `haptics`, `actionItems`, `ideasTab`, `apiRateLimit`, `openAiRetry`, `petitrc/`, `devMarkup/` *(new)* |

---

## 12. Components & the design system

### Primitives — check `src/components/ui/` before writing a new one

`SurfaceCard` · `CardPanel` · `HeroPanel` · `PagedCard` · `panel.tsx` (`PanelTitle`,
`PanelSubtitle`, `HubRowTitle`, `Eyebrow`, `StatStrip`, `StatTile`) · `Button` / `ButtonLink` ·
`PickerSheet` · `SearchableSelect` · `SegmentedControl` · `PillToggle` · `Switch` · `RatingDial` ·
`PrepSlider` · `AnchoredMenu` · `Collapse` · `Reveal` · `ActionToast` · `ExitPromptSheet` ·
`AutoGrowTextarea` · `RelativeTime` · `Spinner` · `PageSkeletons` · `EngineerMarkdown` · `motion`.

### The look — `docs/VISUAL_NORTH_STAR.md` for intent, `src/app/globals.css` for truth

> A premium racing instrument: warm ash surfaces, electric-but-confident yellow for every action,
> **Sora** for everything the driver reads, **Space Grotesk** for page titles alone. One voice —
> the instrument register comes from tabular figures on a six-step ramp, not a second typeface.

**Hard rules:**

- **One theme since 2026-08-18** — "ash paper", stamped as `data-theme="light"` by
  `src/lib/theme/appTheme.ts`. There is no switch and no `rc_theme` cookie. The dark values remain
  as the `:root` ground that paper overrides; **build for paper and do not add a second theme
  path.**
- **Semantic tokens only** (`bg-background`, `text-primary`). Never a raw hex — a hardcoded
  `#FFD60A` is invisible on warm ash paper. The split that matters is `primary` (the yellow) vs
  `primary-ink` (ink you can read on the page).
- **Yellow = actions only.** Green/red = pace and quality deltas only; volume deltas are neutral.
- **Everything must work at 390px with the bottom dock visible.** Mobile is the reference; desktop
  work lives behind `md:`/`lg:`/`xl:` and never edits a base class. Prove it with
  `npm run layout:probe --width=390`, **not** with screenshots (identical code screenshots differ
  by up to 98%).
- **JetBrains Mono was deleted 2026-08-14** (one-voice pass). Figures are Sora + `tabular-nums`
  via the `.fig-*` ramp. Genuine machine text uses `.type-machine` (platform stack, loads nothing).
  Do not reintroduce a webfont for data. Watch the Tailwind v4 `font-mono` → Consolas trap.
- **Yellow buttons wear the primary face** — lit rim + crossing sheen; the aura is deliberately
  FAB-only, and the band rides `background-image` (text can't be washed).
- Visual changes must not alter behaviour, data flow, or API contracts. **Restyle only.**
- Regression nets: `e2e/light-mode-audit.spec.ts` (colour) and `e2e/typography-audit.spec.ts`
  (type), both walking the shared list in `e2e/surfaces.ts`. Plus `npm run check:yellow`.

---

## 13. Testing

- **201 test files**, 114 `test:*` npm scripts, 30 Playwright specs. No runner, no CI.
- Unit tests are pure-logic by design — the codebase repeatedly splits a `server-only` DB module
  from a pure logic module *specifically* so the logic can be tested (`entitlement` /
  `entitlementLogic`, `authAdmin` / `authAdminLogic`, `demoAccess`, `onboarding/visibility`,
  `wizardWalk`).
- Debug preview routes (`/debug/*`) render real surfaces from fixtures with no database — that's
  how the onboarding state machine and sheet-fill are driven without a fresh account.
- Playwright re-mints the E2E account every run: seed after `--project=setup`, then `--no-deps`.
  `prod-guard` blocks `migrate deploy` even on scratch-dev; repair path is `db execute` +
  `migrate resolve`.

---

## 14. Environment variables

**Core:** `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET` / `NEXTAUTH_SECRET`, `AUTH_URL` /
`NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`.
**Auth:** `AUTH_GOOGLE_ID` / `_SECRET`, `EMAIL_SERVER`, `EMAIL_FROM`, `AUTH_ALLOWED_EMAILS`,
`AUTH_ADMIN_EMAILS`, `AUTH_OPEN_SIGNUP`, `AUTH_DEV_ALLOW_ANY_EMAIL`, `SIGNUP_ACCESS_CODE`.
**AI:** `OPENAI_API_KEY`, `ENGINEER_MODEL`, `ENGINEER_API` (`responses` default, `chat` is the
escape hatch), `ENGINEER_JUDGE_MODEL`, `XAI_API_KEY` / `XAI_BASE_URL`.
**Billing:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_{STANDARD,PRO}_{MONTHLY,ANNUAL}`,
`BILLING_ENFORCED`.
**Storage/push:** `BLOB_READ_WRITE_TOKEN`, `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` / `_SUBJECT`,
`APNS_TEAM_ID` / `_KEY_ID` / `_PRIVATE_KEY`.
**Demo & dev:** `DEMO_USER_ID`, `DEMO_USER_EMAIL`, `DEMO_TIMING_SITE`, `DEMO_TIMING_DRIVER_NAME`,
`PERF_INSTRUMENTATION`, `DEBUG_ACCESS_GATE`, `DEBUG_SETUP_UPLOAD_TIMING`, `LAP_IMPORT_USER_AGENT`,
`MYLAPS_OAUTH_CLIENT_ID`.

---

## 15. Conventions that aren't guessable

- **Canonical units:** lap times in **seconds**, temperatures **°C**, wind **km/h**, geometry
  **mm and degrees**, damper oil **cSt**, spring rate **gf/mm**.
- **Delta signs:** lap delta = `cell − anchor` → **positive is slower**. Pace vs field =
  `user − field` → **negative is faster than the field**.
- Field names ending **`Iso`** are UTC machine timestamps — never show one to a user unconverted.
- `src/lib` holds the logic; `src/components` and `src/app` are thin over it.
- A `server-only` module gets a pure twin when its logic needs testing (see §13).
- Setups: **one list, mark not copy** — saving flips `isLibrary` on the existing snapshot, so
  saved run setups are rename-only.
- `allowedDevOrigins` in `next.config.mjs` pins LAN IPs. An unlisted origin serves pages that
  render but silently fail hydration.
- **UTF-8 mojibake hazard:** files sometimes come back double-encoded and feed garbage into the
  Engineer context. Grep before committing prose changes. (There are already a few `â€™`
  sequences in `prisma/schema.prisma` comments.)
- `next dev` has served **stale CSS** through repeated restarts — verify a `globals.css` change
  against `npx next build`, not the dev server. Never hand-write `-webkit-backdrop-filter`.
- Sandboxed `npm run dev` 500s everything (the PostCSS worker dies `0xc0000142`) and reports as
  "Jest worker encountered N child process exceptions". Already-compiled routes still 200, so the
  server *looks* fine — kill the PID on 3000 and relaunch with the sandbox disabled.

---

## 16. Traps that have already cost production time

| What happened | Lesson |
|---|---|
| A PDF route worked locally and 500'd on Vercel three times (`DOMMatrix is not defined`, missing `pdf.worker.mjs`, missing share fonts) | Anything loaded **by runtime path** is invisible to the file tracer. Add it to `outputFileTracingIncludes` and check the route's `.nft.json` after building. |
| Every driver-derived chassis lost its ticks on prod only | Minified pdf-lib class names made `constructor.name` useless. Use `instanceof`. |
| Promoting a preview deployment reverted the nav on prod for 40 min | **Never promote a preview that's behind `main`.** Recover with `vercel promote` of the last `…-git-main-…` build. |
| A teammate's continuous test day split into two dated groups | Group by the **driver's** zone (`Run.localTimeZone`), never the reader's. |
| A cached dashboard model gained a field and warm users saw a broken hero for 30s | **Bump the cache key version** whenever a cached model gains a field. |
| The wizard's setup refusal scrolled to a `display:none` card | Hidden wizard steps still exist in the DOM. |
| 52 "dirty" files turned out to be already committed by another session | `git branch --show-current` before every commit; fetch before a big sweep. |
| `onboarding:cleanup` nuked three deliberate billing fixtures | The blanket cleanup deletes **all** `+ob…` accounts. Delete by exact email. |
| Dev magic links died on the phone | `AUTH_URL` *and* `request.url` both report localhost. Use `/api/auth/dev-new-user`. |

---

## 17. Which north star to read

| Task touches | Read |
|---|---|
| Any `.tsx` — styling, layout, visual rework | `docs/VISUAL_NORTH_STAR.md` |
| Engineer prompts, context, retrieval, chat UX | `docs/ENGINEER_NORTH_STAR.md` |
| Engineer answer quality, evals, benchmarks | `docs/ENGINEER_SUGGESTION_QUALITY_PLAN.md`, `docs/ENGINEER_ITERATION.md` |
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
| Teams | `docs/TEAMS_PILOT.md`, `docs/TEAMS_POST_PILOT_HARDENING.md` |
| Results, trophies | `docs/RESULTS_TROPHIES_NORTH_STAR.md` |
| Writing KB drafts | `docs/VEHICLE_DYNAMICS_PHYSICS_KB_ROADMAP.md` |
| Perf work | `docs/PERFORMANCE.md` |

**A spec is intent, not shipped code.** `docs/NOT_YET_BUILT.md` says what isn't real yet, and no
feature is real because a doc describes it. If nothing in the table matches your task, you don't
need one.

---

## 18. Current state — in flight, uncommitted (2026-08-18)

`main` is at `a5caed2`. The following is **built and working in the tree but not committed** —
treat it as real code, not as a plan:

- **Paddock** (`src/app/paddock/`, `src/components/paddock/`, `src/lib/paddock/`) — the
  2026-08-18 nav restructure. One page replacing `/more`, `/assets` and the Events tab: next
  meeting first (it counts down), then cars, then tracks, then later meetings. The rule it's built
  on: *show the thing, don't name it.* `/cars`, `/tracks` and `/events` are unchanged behind it.
- **Nav restructure** — dock down to four cells, desktop rail down to five tabs, Teams moved into
  Settings, Tools stayed as doors on `/analysis` for phones.
- **Fake LiveRC timing site** (`src/lib/lapUrlParsers/demoTimingSite.ts` + two scripts) — an
  in-memory "Ironbark Raceway" served through `fetchText`, so the website video can show URL Auto
  discovery finding an invented session dated today instead of hostage to a real club's results.
  **Dev only, twice over:** refuses under `NODE_ENV=production` *and* needs `DEMO_TIMING_SITE=1`.
  Driver name must match the account being recorded (the demo account is "Alex Marino").
- **Dev markup layer** (`src/components/devtools/DevMarkupLayer.tsx`, `src/lib/devMarkup/`,
  `/api/dev-markup`) — annotate the running app in the browser.
- **Engineer starter questions** — the Engineer offers something to ask before you know what to
  ask; chat and history are now two separate cards, and the phone disclosure is tri-state.
- **Split runs** — two timing imports on one run read as one run; a day reads as one card.
- **Share as pictures** — runs and setups render to PNG for the OS share sheet (iOS Capacitor file
  share still gated).
- **Sheet editions** — a rebuilt PDF of a known sheet becomes an edition of the same chassis.
- **Ideas/notes tab** — moved off the dock to `42svh`, one dashboard-only nudge until first open.

**Known open items:** the lap-watch cron still doesn't run in production · iOS Universal Links are
owed for the sign-in code · `attach-blank` runs on production are still owed for MTC3 + Mi10 ·
the manufacturer-baseline table deletion is still owed · the demo walkthrough tour builds but its
two mount points are pulled (mobile anchoring misses).
