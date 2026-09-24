# Starter tier — build plan

Status: **BUILT 2026-09-11 (phases 1–4), not yet deployed (phase 5).** Founder rulings 2026-09-09;
the code map was verified against the tree the same day and the build landed two days later. The
phase table at the bottom says what is real; the "Decisions made during the build" section says
where the build departed from the plan and why.

## Amendments (2026-09-15)

- **The window is fifteen runs, not ten.** `STARTER_RUN_WINDOW = 15`. Every "ten" below is the
  original ruling; the code and copy say fifteen.
- **The copy says "runs", not "sessions"**: "Your last fifteen runs.", "Runs kept · Last 15",
  "N older runs · Upgrade" — matching the list's own "10 runs" and "View more · N older runs".
- **Video is on no surface**, in the app or on the site, not even as "soon": the Tools band, the
  run editor's "Video lap sync" card, and the join/landing bullets and compare row are gone. The
  pages still exist by URL and stay Pro-gated.
- **Live Stripe is done**: Starter price `price_1UFkzDHq77U7Enq54mzJYNCQ`, the live portal offers
  all three plans for switching, and `STRIPE_PRICE_STARTER_MONTHLY` is set in Vercel Production.
  The three members still on the old $14.99 Notebook price are family, left as they are.
- The old React welcome page (`src/app/welcome/page.tsx`, unreachable behind the static landing
  rewrite since August) is deleted rather than kept in step.
- **The Engineer is Race Engineer's feature, not Notebook's** (founder call, later 09-15). Notebook's
  one question a day is a taste, and the surfaces say so: Notebook's stat box is "Runs kept · All"
  (parallel to Starter's "Last 15"), its Engineer line is the LAST bullet, worded "A taste of the
  Engineer: one question a day"; Race Engineer's bullets lead with "The Engineer"; the compare row
  is "The Engineer — / Taste · 1 a day / 100 a month"; the intro says "Notebook keeps them all.
  Race Engineer adds the Engineer itself, and the heavy tools." Same on /join, the site, the
  phone rows and the receipt (Notebook receipt confirms "Runs kept · All").
- **Starter's locked Engineer sells Race Engineer** (same call): "Included in Race Engineer ·
  Upgrade to Race Engineer", and both 402 refusals (chat, run candidates) name Race Engineer, via
  `upgradeTierFor`. Gating is unchanged: Notebook still unlocks the Engineer at one a day, so
  `lowestTierWithFeature("engineer")` is still "standard".
- **The Subscription page is rebuilt** (founder, later 09-15: "looks very unfinished"; he
  wanted the website's plan information on it). Top: the member's plan with what THEY pay (their
  own price, so the $14.99 family members never see $9.99 marked as theirs), the renewal date in
  their timezone, and Manage subscription. Below: the same three cards as /join, worded from ONE
  file, `src/components/billing/planCopy.tsx`, which /join now reads too (the landing page is
  static HTML and still carries its own copy). "Your plan" is marked; every other plan's button
  opens Stripe's confirm screen for exactly that price (`subscription_update_confirm`), falling
  back to the plan switcher, then the portal home. The phone folds into the /join rows and one
  button. A past-due member gets no plan buttons, only Manage subscription, so nobody can stack
  a second subscription. Back from Stripe, `?changed=1` refreshes the page twice while the
  webhook lands.
- **Tools are not in Starter; lap time analysis is Notebook's** (founder call, later 09-15, after
  driving Starter: Tools offered "Log a run · Open the lab" and the Lab then said "not
  available"). New feature `lap-analysis` = the `/laps/analysis` room (any timing sheet, any
  driver), in Notebook and Race Engineer; the Geometry Lab stays Race Engineer's. Tools draws
  each bench locked in its own place (`LockedBench`: "Included in X", one line, "Upgrade to
  X"), open benches first: Race Engineer sees the page as before, Notebook sees Laptime Analysis
  then the Lab locked (its car's roll-centre drawing is no longer shown free), Starter sees two
  locked benches, Notebook's first. `/laps/analysis` has a locked twin (segment layout, which
  also covers `/laps/import`), and the competitor practice pull answers 402. Session review is
  untouched: a run's own lap sheet (the pop-up) stays on every plan; its "Detailed analysis"
  door opens the locked page on Starter. Plan cards (`planCopy.tsx`, the landing page) cross
  Laptime Analysis out on Starter and list it on Notebook; the compare table splits "Session
  review" from "Laptime Analysis". Every locked door links `/billing?plan=<tier>`, so the phone
  opens with that plan picked.
- **Amended 2026-09-24 (founder call): lap time analysis is Race Engineer's, not Notebook's.**
  `lap-analysis` moved from Notebook's features to Race Engineer's, so Notebook now meets Tools
  exactly as Starter does (two locked benches, both "Included in Race Engineer"), the
  "Detailed analysis" door opens the locked page on both, and the lap sheet's Practice tab (other
  drivers' practice, `/api/laps/practice-field`) is Race Engineer's too. The line: sessions you
  drove are the notebook's, reading anyone else's is Race Engineer's. Plan cards cross Laptime
  Analysis out on Notebook and list it on Race Engineer.

## The rulings (2026-09-09)

| Question | Ruling |
|---|---|
| Price | **$2.99 AUD / month, monthly only.** No annual. "A number you pay without thinking about." |
| Why paid, not free | The three dollars is a bouncer, not revenue. Every account goes through the same Stripe door; a card on file is the only thing stopping fifty throwaway accounts writing into the shared track catalog, chassis list and community setup numbers. Free can be flipped on later as a price change (a $0 Stripe price through the same door); paid → free upsets nobody, free → paid does. |
| What "session" means | **One run.** Ten runs is one race weekend or two club nights. The pressure lands at the track on Sunday when Saturday's practice disappears. Ten track days was rejected as far too much value at this price. |
| The window | **The ten most recent runs are visible. Everything older is hidden, never deleted.** Run eleven hides run one. Upgrading to Notebook or Race Engineer brings every hidden run back instantly. Downgrading hides again. |
| Engineer | **None.** Not four a month, none. The page stays visible but locked, the same pattern as roll-centre for Notebook. At US$0.048 an answer the tier cannot fund even one question a day. |
| Not a trial | A trial ends on a date, usually a Tuesday. This never ends, it forgets. Do not call it a trial anywhere. |
| Name | Working label **Starter**. Lives in `TIER_LABELS` like the other two; change it there and nowhere else. Tier id in the database, Stripe metadata and code is **`starter`**. |
| Everything else | Same as Notebook: logging, review, compare, lap import, setup sheets, Paddock, teams. Video and roll-centre locked exactly as they are for Notebook. |

## What a Starter member sees

- The join page shows three cards. Starter's card says $2.99 a month, "Your last ten sessions", no
  Engineer. The interval toggle does not apply to it.
- They log runs like anyone else. From run eleven on, the Sessions list ends with one row:
  **"N older sessions · Upgrade"** linking to `/billing`. That row is the entire upsell surface.
- Hidden runs are gone from every screen: Sessions, the run page (404), dashboard, Paddock, car and
  track pages, lap picker, compare, setup history, teammates' views of them, the Engineer's context
  (moot, they have no Engineer), and counts.
- `/engineer` renders the locked panel with "Included in Notebook" and an upgrade button. The chat
  API answers 402.
- On `/billing` they see "Current plan: Starter" and an **Upgrade** button that opens Stripe's
  portal plan-switch flow. Never a second checkout (see the hazard below).

## Design: one column, one routine, one choke point

There are 129 places that read runs across 62 files, plus 8 nested reads and one raw-SQL path
(the demo date shift). Touching them all is a week and a guaranteed leak. Instead:

### 1. One column

`Run.hiddenByPlanAt DateTime?` — null for a visible run. Nothing else changes on the row. Index it
with the existing `@@index([userId, sortAt])` neighbour: `@@index([userId, hiddenByPlanAt])`.

### 2. One routine: `applyRunWindow(userId)`

`src/lib/runs/runWindow.ts`. Pure-ish, idempotent, two `updateMany` calls, safe to call as often
as you like:

1. Resolve the owner's tier (`resolveEntitlement` by id — not by the viewer, by the **owner**).
2. If the tier is not `starter` (Notebook, Race Engineer, admin, enforcement off, lapsed): clear
   `hiddenByPlanAt` on every run the user owns. Done.
3. If `starter`: read the user's run ids ordered `sortAt desc` **through the unscoped delegate**
   (see 3), take the first `STARTER_RUN_WINDOW = 10`, then
   `updateMany({ id in rest, hiddenByPlanAt: null } → now)` and
   `updateMany({ id in first ten, hiddenByPlanAt: not null } → null)`.

Every run row counts toward the ten, drafts included. A started-and-abandoned run is a session
they started; drafts already expire on their own. This is also what makes the rule explainable in
one sentence.

Called from exactly these places, after the write commits:

| Trigger | File |
|---|---|
| Run created | `src/app/api/runs/route.ts` mode `create` (the only production creator) |
| Run deleted | `src/app/api/runs/[id]/route.ts` DELETE |
| Run reordered (moves `sortAt`) | `src/app/api/runs/[id]/reorder/route.ts` |
| Plan changed | `src/app/api/stripe/webhook/route.ts` `syncSubscription`, after the upsert |
| Nightly safety net | new `/api/cron/run-window-sweep`, added to `vercel.json` next to `refresh-demo`; walks every user with a `starter` subscription row |

Ownership never moves (`Run.userId` is never reassigned anywhere), so the flag is stable.

### 3. One choke point: a Prisma query extension

`src/lib/prisma.ts` already chains a `$extends` (the perf extension, cast back to `PrismaClient`).
Add `runWindowExtension` (`src/lib/runs/runWindowExtension.ts`) on model `run` for every read op
(`findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `count`,
`aggregate`, `groupBy`): rewrite `where` to `{ AND: [where, { hiddenByPlanAt: null }] }`.
Prisma 6 accepts extra non-unique filters on `findUnique`. Always AND, never merge, so **the
exported `prisma` client can never see a hidden run, full stop.**

Export a second delegate from the same file for the three internals that must see everything:
`runsIncludingHidden` = the base client's `run` delegate, used only by:

- `applyRunWindow` itself,
- the Sessions page's hidden-count query (for the upgrade row),
- `src/lib/setupAggregations/rebuildCarParameterAggregations.ts:67` — community numbers stay whole;
  hiding is about what the driver sees, not the shared pool.

Write ops are untouched. A hidden run cannot be edited or deleted through the API because every
route does a scoped `findFirst` ownership read first, which now misses — correct and consistent.

### 4. The eight reads the extension cannot see

Relation-nested reads resolve inside the parent query. Each gets an explicit
`where: { hiddenByPlanAt: null }`:

| File:line | Form |
|---|---|
| `src/app/cars/[carId]/setups/new/page.tsx:169` | `runs: {…}` on SetupSnapshot |
| `src/app/cars/[carId]/setups/[setupId]/edit/page.tsx:80` | same |
| `src/app/cars/[carId]/setups/[setupId]/page.tsx:97` and `:122` | same, twice |
| `src/lib/setup/getCarSetupHistory.ts:148` | `runs: { none: {} }` → `runs: { none: { hiddenByPlanAt: null } }` (a library setup whose only runs are hidden should read as unused) |
| `src/lib/setup/getCarSetupHistory.ts:~131` | `_count: { select: { runs: { where: { hiddenByPlanAt: null } } } }` |
| `src/app/tracks/page.tsx:88` | `runs: { some: { userId, hiddenByPlanAt: null } }` |
| `src/app/api/auth/dev-signin/route.ts:81` | dev only, leave |

Raw SQL: only the demo date shift touches `"Run"`, scoped to the demo user, who is never Starter.
Leave it.

### 5. Accepted edges (decided, do not re-open without a reason)

- **Imported timing sessions are not windowed.** `ImportedLapTimeSession` is read by user in 30
  places without going through Run. A hidden run's laps also live on its imported session, so a
  Starter member can still see old lap times via the imported-sessions list and Tools. That is
  scraped public timing data, not their notebook. Revisit only if it is actually abused.
- **Library setups are not windowed.** Saved setups (`isLibrary`) are not runs.
- **Team feed rows already written** referencing a now-hidden run 404 on tap. Acceptable.

## Billing plumbing

### Tier

- `src/lib/entitlementLogic.ts`: `Tier = "none" | "starter" | "standard" | "pro"`;
  `STARTER_FEATURES = ["logging", "review", "compare"]`;
  `deriveSubscriptionTier` line 88 becomes an explicit three-way (`pro` → pro, `starter` → starter,
  anything else → standard). **Today an unknown tier string collapses to Notebook. A `starter`
  subscription hitting the current code gets full Notebook for $2.99.** This is why deploy order
  matters (below).
- `src/lib/stripe.ts`: `PRICE_ENV_KEYS` + `getPricePlans()` gain `STRIPE_PRICE_STARTER_MONTHLY`;
  `tierFromEnvPriceId` and `resolveTierForPriceId` accept `starter` (line 145 check and the three
  `"standard"` fail-safes stay as they are — failing safe to Notebook is still right for a genuinely
  unknown price).
- `src/lib/brand/brandNames.ts`: `TIER_LABELS.starter = "Starter"`. Widening the record type makes
  the compiler list every consumer: `JoinPlansClient`, `ProLockedPanel`, `entitlementGuards:79`,
  `budgets.ts:275,284`, `engineerQuotaNote`, both Stripe scripts, `dev-billing-states`.
- Budget code (`budgets.ts`, `ledger.ts`, `engineer/chat/route.ts:226-231`) narrows to
  `"standard" | "pro"`; Starter never reaches it because the feature gate fires first. Narrow the
  types, do not add a Starter budget.

### Engineer gate

- `src/app/engineer/page.tsx`: `isFeatureLockedForCurrentUser("engineer")` → render
  `ProLockedPanel` with the Notebook label. `ProLockedPanel` currently hardcodes `TIER_LABELS.pro`;
  give it an `includedIn: Tier` prop.
- `src/app/api/engineer/chat/route.ts` and `src/app/api/engineer/run-candidates/route.ts`:
  `requireApiFeature("engineer")` before anything else (402, same as video).
- Nav entry stays (visible-but-locked ruling, MONETISATION_NORTH_STAR).
- `engineerQuotaNote.ts`: starter branch returns null (no meter to show).

### Stripe

- `scripts/stripe-setup-prices.ts` and `scripts/launch-live-stripe.ts`: add
  `{ tier: "starter", name: "JRC Trackside — Starter", monthly: 299 }` with no annual price.
  Product `metadata.tier = "starter"`, lookup key `rc_engineer_starter_monthly` (the existing
  keys' naming, not the bare `starter_monthly` first written here). Both scripts also now keep
  the portal's plan-switch list current (`ensurePortalPlanSwitching`), which the Upgrade button
  depends on.
- Env: `STRIPE_PRICE_STARTER_MONTHLY` in Vercel Production and `.env.local`.
- Checkout validation (`api/billing/checkout`, `api/billing/public-checkout`) already accepts any
  price from `getPricePlans()`; nothing to do.

### The upgrade path hazard

`POST /api/billing/checkout` creates a **new** subscription for the customer. Today no member sees
that button while subscribed, so it has never mattered. With a ladder it does: a Starter member
tapping Notebook would end up paying for two subscriptions. Rule: **an existing subscriber never
goes through checkout again.**

- `/billing` for a subscribed member shows one **Upgrade** button (and for Race Engineer none).
- It calls `POST /api/billing/portal` with `flow_data: { type: "subscription_update" }` so Stripe's
  portal opens straight on the plan switcher with proration.
- The portal configuration must list all three products under `subscription_update.products`.
  Set it once in the Stripe dashboard (test and live) or add it to `launch-live-stripe.ts`.
- The webhook's `customer.subscription.updated` then rewrites `Subscription.tier` and calls
  `applyRunWindow`.

### Deploy order (mandatory — but the opposite of the 2026-08-06 reprice)

The hazard is the same as the reprice: code that does not know `starter` hands a Starter buyer
full Notebook. What differs is that nobody can BUY Starter until the join page offers it, and the
join page only offers it once the deployed code reads `STRIPE_PRICE_STARTER_MONTHLY`. The live
code today ignores that key entirely, and checkout refuses any price it does not list. So the
price and the env var are inert until the new code is live, and the safe order is:

1. Run `npm run stripe:launch-live` to create the live Starter product and price (and update the
   live portal's plan-switch list). Nobody can reach the price yet.
2. Add `STRIPE_PRICE_STARTER_MONTHLY` to Vercel Production. The live code does not read it.
3. Deploy the code (push `main`). Everything switches on together: `/join` offers Starter, the
   landing page's Starter card (static, live from this deploy) points at a join page that has it,
   and the webhook resolves the price to `starter`.

The reprice order (code first, then price) is also safe here, but it opens a window where the
landing page advertises a card the join page cannot sell. Price first closes it.

## UI

| Surface | Change |
|---|---|
| `src/components/billing/JoinPlansClient.tsx` | Three cards on desktop (`md:grid-cols-3`), third radio row on the phone fold, a Starter column in `COMPARE_ROWS` ("Sessions kept: last 10 / all / all", "Engineer: — / 1 a day / 100 a month"). Starter card ignores the annual toggle and always shows $2.99/mo. Join page is a locked design (see memory `join-page-redesign-locked`): add a card, do not restyle. |
| `src/app/join/page.tsx:99-101` | Widen the tier filter. |
| `src/app/join/success/page.tsx:56-77` | Starter receipt: no questions-per-period line. |
| `public/landing/index.html:622-651` | The live marketing page has prices hardcoded. Add the Starter card. The shop front's table must say what the join page says (commit 8111bc3). |
| `src/components/runs/RunHistoryViewMore.tsx` | When the viewer is Starter and `hiddenCount > 0`: replace the "View more" link with **"N older sessions · Upgrade"** → `/billing`. Lands in all three placements at once. No blurb. |
| `src/app/runs/history/page.tsx` | Pass `hiddenCount` (via `runsIncludingHidden.count({ userId, hiddenByPlanAt: { not: null } })`) and the tier. |
| `src/components/billing/BillingClient.tsx` | "Current plan: Starter"; Upgrade button (portal flow) instead of Subscribe buttons for anyone already subscribed. |
| `src/app/engineer/page.tsx` | Locked panel branch. |

Copy budget per the no-blurb rule: the Starter card gets "Your last ten sessions" and nothing
explaining what happens to the eleventh. The Sessions row explains itself by existing.

## Tests and verification

| What | How |
|---|---|
| Tier logic | `src/lib/entitlementLogic.test.ts`: `starter` resolves, `starter` lacks `engineer`, unknown string still → standard. `npm run test:entitlement`. |
| Window routine + extension | New `src/lib/runs/runWindow.test.ts` (DB, scratch-dev via the `entitlement.test.ts` invocation): seed a starter user with 15 runs, assert `prisma.run.count` = 10 and `runsIncludingHidden.count` = 15; delete a visible run → 10 visible again (one un-hides); flip the subscription row to `standard` → `applyRunWindow` → 15 visible; reorder a hidden run to the top → visible, another hides. `npm run test:run-window`. |
| Leak sweep | Same test hits the read paths that matter most: `for-picker`, `teammate-for-picker` (viewer is a Notebook teammate, owner is Starter → 10), `getCarSetupHistory`, `loadDashboardModel`, `buildDriverDataBlocks`. |
| Billing states | `scripts/dev-billing-states.ts`: add a `starter` state with expectation "/engineer locked · Sessions shows 'N older sessions · Upgrade' after 11 runs". `npm run billing:states` under `npm run dev:enforced`. |
| Drive it | Sign in as the starter state, log eleven runs via the wizard, watch run one leave the list and the upgrade row appear, open the run's old URL (404), tap Upgrade, complete the portal switch in test mode, confirm all eleven come back. Screenshot the Sessions foot at 390px. |
| Gates | `npx tsc --noEmit` → `test:entitlement`, `test:run-window`, `test:paid-signup`, `test:stripe-sync` → `npx next build`. |

### Drive note (2026-09-11)

Driven in a real browser against the dev server with `BILLING_ENFORCED=1`, signed in as the
`+ob-billing-starter` fixture (which now carries a real test-mode Stripe customer and an active
Starter subscription, plus 12 seeded runs):

- `/engineer` renders the locked panel — "INCLUDED IN NOTEBOOK", the one-line blurb, "Upgrade to
  Notebook". `GET /api/engineer/run-candidates` answers 402.
- `/runs/history` shows the day with "10 runs" and ends with **"2 older sessions · Upgrade"**.
- `/billing` shows "Current subscription: Starter · active", "Current plan: Starter.", one
  **Upgrade / Change plan** button and "Manage subscription" — no Subscribe buttons.
- Tapping Upgrade: `POST /api/billing/portal { flow: "subscription_update" }` answers 200 with a
  `billing.stripe.com` URL that opens on **"Change subscription"** listing Starter (current),
  Notebook and Race Engineer. A fake customer id (the old fixture) makes the route answer 502
  with a message instead of throwing.
- `/join` signed out: three cards at 1280, three rows plus the four-column compare table at 390.
  The landing page serves the Starter card.
- Not driven: paying through Stripe's hosted checkout and completing the plan switch on the
  portal page (both are Stripe-hosted; the app side of each was exercised).

## Migration

One nullable column plus one index: `prisma/migrations/20260911120000_run_hidden_by_plan`.
Hand-written, applied to scratch-dev through the sanctioned repair path (`prisma db execute
--file` then `prisma migrate resolve --applied`, because `prod-guard.cjs` blocks `migrate deploy`
against any host); production picks it up from `vercel-build.cjs` on deploy. No backfill: null
means visible, and nobody is Starter until the price exists.

## Decisions made during the build (2026-09-11)

- **Setup usage counts still count hidden runs.** `_count.runs` on a setup snapshot appears in
  seven places, and three of them are write guards (a setup a run recorded cannot be edited in
  place or deleted). A hidden run still recorded that setup, so the guards must keep counting it,
  and the display counts were left consistent with them. The one exception is the setup-document
  list in `getCarSetupHistory`, which is display only and follows the plan.
- **The Starter card appears only once its price is configured.** `/join` renders the third card,
  the third phone row and the third compare column when a `starter` plan is in `getPricePlans()`;
  without the env var it is byte-for-byte the two-tier page. The landing page card is static and
  live from the deploy, hence the deploy order above.
- **The Upgrade button falls back.** If Stripe refuses the `subscription_update` flow (portal
  configuration not listing the products), `/api/billing/portal` logs the refusal and opens the
  plain portal so a member can still manage. Both Stripe scripts now write that configuration,
  so the fallback should never fire; if the log line appears, run the script.
- **Which subscribers see the plan grid.** `/billing` decides "live subscriber" from the
  `Subscription` row's status, not from the entitlement: with billing dark the entitlement says
  full access for everyone, and that must not re-open checkout to a payer.
- **`applyRunWindow` also runs after a run UPDATE.** A draft finished on a different day moves its
  `sortAt`, so the create/update route calls it for both modes.
- **The nightly sweep visits stamps too.** Not only `starter` subscriptions: anyone with a
  `hiddenByPlanAt` left behind by a missed plan-change webhook, so a paid upgrade never stays
  hidden longer than a night.
- **`PaidTier` and `lowestTierWithFeature`.** The 402 and the locked panel name the cheapest tier
  that has the feature ("Included in Notebook" for the Engineer), instead of hardcoding Race
  Engineer.

## Out of scope

- Annual Starter price (ruled out).
- A Starter Engineer budget (ruled out).
- Windowing imported timing sessions or library setups (accepted edge).
- A settings billing row (does not exist today for any tier; separate ask).
- Flipping Starter to $0 (a price change through the same door if ever wanted; nothing here
  prevents it).

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Tier plumbing: `Tier`, features, labels, `deriveSubscriptionTier`, `resolveTierForPriceId`, price env, Engineer gate, tests | ✅ built 2026-09-11 — `test:entitlement` 20/20 |
| 2 | Column + migration, `applyRunWindow`, extension, the eight nested reads, cron sweep, `test:run-window` | ✅ built 2026-09-11 — `test:run-window` 15/15 against scratch-dev; `vercel.json` carries the second cron (Hobby allows two) |
| 3 | UI: join cards, landing page, success receipt, Sessions upgrade row, `/billing` Upgrade via portal flow, locked Engineer panel | ✅ built 2026-09-11 — driven in a browser with billing enforced (see the drive note below) |
| 4 | Stripe: script tier def, portal configuration, test-mode drive of subscribe → 11 runs → upgrade → all back | ✅ test mode 2026-09-11 — `stripe:setup-prices` created the Starter test price and updated the default portal configuration to list all three products; `.env.local` carries `STRIPE_PRICE_STARTER_MONTHLY`. The end-to-end paid checkout → upgrade in the portal was NOT driven (it needs a test card in Stripe's hosted pages); the portal session for the plan switch was requested from the app and answered with a Stripe URL |
| 5 | Deploy in the order above; live price; Vercel env; `docs/MONETISATION_NORTH_STAR.md` tier table + non-goals row rewritten ("A free tier" → "A free tier without a card") | north star rewritten 2026-09-11; **deploy not done** — three founder steps: run `npm run stripe:launch-live`, add `STRIPE_PRICE_STARTER_MONTHLY` to Vercel Production, push `main` |
