# Monetisation North Star — the paid door, the demo, the launch

**Status:** Locked by founder interview 2026-08-01 (three rounds of questions, all answered).
Phase 1 in progress. **Owner:** Jordan. Sits beside `ONBOARDING_NORTH_STAR.md` (what a new account
sees once inside) — this doc governs how anyone *gets* an account at all.

---

## One sentence

> Payment is the only door into the app; a full-data demo does the selling that a free trial
> would, so nobody ever pays for an empty shell they haven't felt.

## Locked decisions (founder interview 2026-08-01)

| Decision | Call |
|---|---|
| **The door** | **Pay to sign up. No free tier, no open signup, no trial.** The demo is the try-before-you-buy. Rejected: card-up-front Stripe trial (trial accounts burn Engineer budget before paying), money-back-window-as-trial framing. |
| **Refunds** | **14-day money-back, stated plainly at checkout.** Converts would-be chargebacks into clean refunds; protects word-of-mouth in a niche scene. |
| **Tiers** | **Notebook $9.99 · Race Engineer $19.99 AUD/mo** (+ annual $99.90 / $199.90, two months free). Repriced and renamed 2026-08-06 — see the reprice note below. Notebook = the smart notebook with a taste of the Engineer; Race Engineer = the real Engineer tier + video + roll-center. **Tier IDs remain `standard` / `pro`** in the database, in Stripe product `metadata.tier`, and throughout the code; only the labels moved, and they live in `TIER_LABELS` (`src/lib/brand/brandNames.ts`). |
| **Engineer caps** | **Notebook 1 question/day · Race Engineer 100/month pool.** At the MEASURED rate (see below) a drained Notebook month costs ~US$1.45 against ~US$6.19 net, a drained Race Engineer pool ~US$4.83 against ~US$12.58 net — and both stay profitable even if nothing caches at all. The pitch is no longer volume (30 vs 100 is only 3×) but **burst**: a Race Engineer can spend a weekend's questions on Saturday, which a Notebook member structurally cannot, and gets video + roll-center with it. Cap-hit copy must sell the upgrade, never read as a limit error. Race Engineer needs a "remaining this month" meter. |
| **Pro gating** | Video + roll-center **visible-but-locked** for Standard — one line on what it does, an example, "Upgrade to Pro". The only upsell channel that exists once there's no free tier. Rejected: hiding Pro features from Standard. |
| **Demo** | **Shared read-only demo account** running as **Pro**, public route, seeded from **Jordan's real season, curated subset**, anonymized to a fictional driver — racers smell fake lap times. Curated Engineer threads readable free. ⚠️ Two clauses of this decision were **superseded 2026-08-25**: *frozen snapshot* (the season now rolls forward nightly — see [The demo's clock](#the-demos-clock--2026-08-25)) and *1–2 live Engineer asks per visitor* (the demo answers nothing at all now — see [The demo stops answering](#the-demo-stops-answering--2026-08-25)). |
| **Front door** | **Small landing page** (what it is, three value points, pricing) → **Try the demo** / **Get started**. Built last — its buttons need somewhere real to go. |
| **Existing testers** | **Comp'd via 100%-off promo codes through the same checkout** — one provisioning path for everyone, comps can later expire or convert without code changes. `allow_promotion_codes` is already on. Consequence: the existing *grandfather* branch in `entitlement.ts` should retire once codes go out (see hazard below). |
| **Build order** | Paid door + enforcement first (all verifiable in Stripe test mode with `BILLING_ENFORCED` dark) → demo → landing page → flip. |

## The provisioning inversion

Today: sign in (allowlist) → `/billing` → checkout as an authenticated user. The paid door
inverts it:

1. **Public checkout** — `/join` (public pricing page) → `POST /api/billing/public-checkout`
   (unauthenticated, rate-limited, price id validated against `getPricePlans()`) → Stripe Checkout
   collects the email. Session carries `metadata.source = "public-signup"`.
2. **Webhook provisions** — on `checkout.session.completed` for a public-signup session:
   find-or-create the `User` by the checkout email, link `stripeCustomerId`, sync the
   `Subscription` row (existing path), then **mint a magic link and email it** (same
   token scheme as `scripts/dev-fresh-onboarding.ts`, same email template as `auth.ts`).
3. **First sign-in** — the magic link lands them on the dashboard; the existing onboarding
   (welcome overlay + "Get set up" card, `ONBOARDING_NORTH_STAR.md`) takes over.

**Sign-in gate:** paying customers are deliberately **NOT** added to `AuthAllowedEmail`.
`isGrandfatheredEmail` treats every allowlist row as pre-paywall-tester-free-forever, so
allowlisting payers would grant permanent free Pro the moment they cancel. Instead
`isEmailAuthAllowed` accepts any account that has a `Subscription` row (any status — a lapsed
subscriber must still be able to sign in to reach `/billing` and renew). The allowlist stays
strictly the invite list.

## The reprice — 2026-08-06

Founder call five days after launch: cut prices to drive volume, and rename the tiers to the
language the landing page already used ("The notebook, or the race engineer").

| | Was | Now |
|---|---|---|
| Cheap tier | Standard $14.99 · 2 q/day | **Notebook $9.99 · 1 q/day** · annual $99.90 |
| Full tier | Pro $27.99 · 300 q/month | **Race Engineer $19.99 · 100 q/month** · annual $199.90 |

**What the old margin note got wrong.** It read "a drained Pro pool $16.50 — profitable even at
max" against $27.99. That compared **AUD revenue to USD cost**: $27.99 AUD is ~US$18.20 gross,
~US$17.67 net of Stripe, against US$16.50 of AI — roughly break-even, not comfortable. The `$0.055`
per-answer figure was also the **cached** case; `budgets.ts` separately recorded that an uncached
answer at ~79K prompt is ~4× that.

**What was actually measured** (prod `AiUsageDaily`, all 77 `engineer-chat` answers, 2026-08-06):

| | Value |
|---|---|
| Blended cost per answer | **US$0.048** |
| Since the terra ship (2026-08-01) | US$0.048 |
| Implied prompt-cache hit | 58% |
| Average prompt | **~42K tokens** — not the ~79K the old note assumed; the v0 KB rebuild roughly halved it |
| Same answer with zero caching | **US$0.097** |

That US$0.097 worst case is what makes the new numbers safe: at 100 questions a Race Engineer
member costs at most US$9.73 against US$12.58 net, so the tier is profitable at a full drain even
if the cache never hits once. Notebook at 1/day is the tier that needed the cut — at 2/day and
30 cold days it would have run at a loss.

**Re-measure before moving these numbers again.** The script that produced the table is a plain
aggregate over `AiUsageDaily` (`costUsd / calls`, filtered to `engineer-chat`); the sample was 3
users, essentially the founder and testers, so it reflects founder usage patterns rather than a
cohort. Note also that the pool is a **rolling 30 days**, not a calendar month.

**The bug this would have caused.** `tierForPriceId` resolved a member's tier by matching their
price id against the currently configured `STRIPE_PRICE_*` env vars, falling back to `"standard"`.
Stripe prices are immutable, so repricing mints new ids while every existing subscriber keeps the
old one — their next routine `invoice.paid` sync would have silently demoted them, comped testers
included. Replaced by `resolveTierForPriceId`, which falls back to the price's **product
`metadata.tier`** and so survives every future reprice. This had to ship BEFORE the new prices
existed.

## The demo's clock — 2026-08-25

The locked decision above calls the demo a **frozen snapshot**, and that word turned out to be
the bug. The demo is a copy of the founder's real season with its real dates, and the app reads
almost everything through rolling windows. Measured on production 2026-08-25, off a snapshot
ending 19 July, an anonymous visitor's first screen said:

> `Runs · 30d 0` · `Laps 0` · `Wheel time 0m` · `Active days 0` · `Tracks 0` · `Best streak 0d`
> — and, below it, "No runs in the last 30 days · last out 19 Jul".

The demo is the entire selling mechanism of a no-free-tier product, and it was showing a driver
who had given up. **Re-seeding cannot fix this**: the window is `now − months`, but the newest
row the seed can copy is the founder's newest real run, so a re-seed lands on the same ending.

**The fix — the season moves instead.** One delta added to every date the demo owns, so the run
of events keeps its order and its spacing and simply sits later in the calendar. Anchored so the
newest run is `DEMO_RECENCY_LAG_DAYS` (2) behind today.

| Piece | Where |
|---|---|
| Arithmetic, manifest of every dated table, unit tests | `src/lib/demo/demoDateShift.ts` (+ `.test.ts`, `npm run test:demo-dates`) |
| The SQL that applies a delta | `src/lib/demo/applyDemoDateShift.ts` |
| Anchoring pass at the end of a re-seed | `scripts/seed-demo-account.ts` (`--lag-days`) |
| Hand control / dry run | `npm run demo:refresh -- --dry-run` |
| Nightly, unattended | `/api/cron/refresh-demo` + the `crons` entry in `vercel.json` |

Non-destructive and self-correcting: arithmetic UPDATEs over rows the demo account owns, no
deletes, no other user's rows in scope on any table, no-op under half a day of drift, and a
missed fortnight is caught up in one shift.

**Events are now cloned, not shared.** The seed used to point demo runs at the founder's global
`Event` rows. That leaked — `loadOutWithYou` finds other drivers by shared event, so the demo's
Teammates card was showing the founder's real name and best lap to every anonymous visitor — and
it froze, because a shared meeting cannot be moved by the shift without dragging the date under
every real driver who raced it. Demo events are demo-owned and hang off the demo's own cloned
tracks; both event-discovery queries are scoped by `trackId`, so no real user can reach them. The
seed prints a leak check (`demo runs on an event the demo does not own`) that must read 0.

**Consequence, accepted:** with no shared scope, the demo has no co-presence peers, so the
Teammates card no longer renders in the demo at all. Privacy beats demonstrating that one card.
Giving the demo a second fictional driver would bring it back — not built.

**Known cosmetic drift:** two of the ten meetings carry real titles ("NSW State Titles", "2026
QLD State Titles") and the shift moves them off their real dates. Harmless to an outsider,
noticeable to a local. Renaming them in `demo-curation-overlay.json` would need the overlay to
learn about events — not built.

**The door's facts were silently failing too.** `/demo` should introduce the season it is about
to hand over; on production it showed nothing but "Access · Read-only" while the same queries by
hand returned 178 runs across 6 tracks. `demoSeasonFacts.ts` swallowed the error without logging
and cached the empty answer in `unstable_cache`, which persists across deploys — so one bad read
pinned an empty first impression indefinitely. Now it logs, and memoises in-process for ten
minutes, never caching an empty result.

## The demo stops answering — 2026-08-25

**Founder call, reversing the "1–2 live Engineer asks per visitor" line in the locked decisions
above:** the demo does not need to *answer* questions, it needs a really good record of questions
it has already answered.

Better pitch and a far better thing to operate. A visitor reading sixteen real conversations —
including the Engineer reading a weekend back to the driver, run by run, with lap times — is a
stronger proof than two questions of their own about a car they have never driven. And the
operational tail disappears entirely: no per-IP throttle leaking across serverless instances, no
global spend ceiling, no way for a launch-day crowd to make the Engineer go dark for everyone who
arrives after them, and **no anonymous path to an LLM bill at all**. The 15/day · 100/month
ceiling that would have needed raising for launch simply stops existing.

| Piece | Where |
|---|---|
| The door, closed | `DEMO_WRITE_ALLOWLIST` in `demoAccess.ts` is now empty — the demo is read-only with no exceptions |
| Second lock | First statement in `POST /api/engineer/chat`: identity cannot drift the way a path string in a Set can |
| The reader | `DemoEngineerReadingNote` / `DemoEngineerEmptyState`, wired into `EngineerChatPanel` behind `isDemoSession` |
| The history | `includeThreadIds` in `demo-curation-overlay.json` — 16 threads, 82 messages |

**The composer is replaced, not disabled.** A greyed-out box invites a visitor to try typing and
be refused, which is the worst version of the moment. Under a conversation they have just read
sits one sentence about whose answers these are, and a door. The subject bar, anchor picker,
starter questions, "New chat" and the per-thread **Delete** go with it — every one is a control
for steering or destroying a conversation a demo visitor cannot have, and Delete in particular sat
against every row of someone else's season on a page whose own banner says read-only.

**Curation is the work now, and it is not finished.** Sixteen threads were chosen for spread —
what the Engineer read off an actual run, a twenty-message back-and-forth where the first change
made the car worse, planning a test day from previous ones, and the plain-language questions a
driver actually types. **Eleven predate the v0 Engineer rebuild (2026-08-05)**, which deliberately
runs on less context than the system that answered them. They are the meatiest answers in the
account, which is exactly the risk: a demo showing answers the shipping Engineer would not produce
today oversells, and an oversold demo becomes a refund. They are marked `pre-v0` in the overlay's
`$threadNotes` — read them before a public launch and cut any that no longer represent the app.

**Conversations needed their own anchor.** The season shift is anchored on the newest RUN, and the
founder kept asking the Engineer questions for a month after he stopped racing — so his newest
thread is 32 days newer than his newest run, and the season delta threw the copied history to
**24 September against a 25 August today**. Caught on the first real seed. `placeDemoThread` gives
the thread set its own delta so nothing lands in the future, then pushes any run-anchored thread
forward to sit after the run it discusses. Both rules are unit-tested; the seed reports how many
threads moved for run order.

**Middleware was blocking every cron.** `/api/cron/*` was matched by the session gate, so a
Vercel Cron request — no cookie, `Bearer $CRON_SECRET` — got a 401 before reaching its route.
Exempted now; each cron route still checks the secret itself. This also unblocks
`watch-results`, which has never fired in production.

## Hazards

- **Grandfather vs comp codes.** Every current `AuthAllowedEmail` row resolves to free Pro forever
  while the grandfather branch exists. The locked decision is comps-via-codes, so at launch (Phase
  5) the grandfather branch retires and testers redeem their 100% codes. Until then the two
  mechanisms overlap harmlessly (enforcement is dark).
- **Webhook email delivery.** The magic-link send happens inside the webhook handler; a send
  failure 500s the event so Stripe retries (user creation is idempotent by email). "Paid but the
  email never arrived" is the support case — the success page tells them to check spam and offers
  the support address.
- **Repricing is a two-step deploy.** The `resolveTierForPriceId` fix must be live BEFORE the new
  Stripe prices are created, or existing members are demoted on their next invoice. Then run the
  setup script (test), update `.env.local`, run `stripe:launch-live`, and paste the four new ids
  into Vercel Production. Old prices stay active by design so current members keep their rate.

## Rollout

| Phase | Scope | Status |
|---|---|---|
| **0** | Founder interview → this doc | ✅ 2026-08-01 |
| **1** | Paid door: `/join`, public checkout, webhook provisioning + magic link, paid-subscriber sign-in gate | ✅ built + driven end-to-end in Stripe test mode 2026-08-01 (real checkout w/ test card → signed webhook → provisioned user, no allowlist row → magic link → welcome overlay on a fresh account) |
| **2** | Enforcement: shell gate (`requireCurrentUser` bounces unpaid → /billing; `/billing` uses `requireCurrentUserAllowUnpaid`), video + roll-center visible-but-locked via segment layouts + 402 API guards, Engineer caps (2/day · 300/mo pool, upsell cap-hit copy, body meter), lapsed-sub chat 402 | ✅ built + driven with `BILLING_ENFORCED=1` in dev 2026-08-01 (lapsed → /billing, Standard → locked panels + refused 3rd question, Pro → open + 300/mo meter) |
| **3** | Demo: snapshot/anonymize script, public `/demo`, read-only guard, pre-baked threads, capped live asks | ✅ **LIVE.** Deferred on 2026-08-01, built after; `/demo`, `seed-demo-account.ts`, the middleware read-only guard and curated threads are all serving on prod. Hardened for launch 2026-08-25 — see **The demo's clock** below. |
| **4** | Landing page: public `/welcome` (brand treatment, value trio, live prices, Get started → `/join`); unauthenticated `/` lands there; no app chrome on public routes | ✅ built + driven 2026-08-01 |
| **5** | Launch prep: grandfather retired to admins-only, price script → $27.99 (immutable-price replacement w/ lookup-key transfer), `payment_method_collection: if_required` for $0 comps, JRC-TESTER 100% code driven end-to-end in test mode ($0 checkout, no card → webhook → active sub) | ✅ **LAUNCHED 2026-08-01: BILLING_ENFORCED=1 live at www.jrcdynamics.com.** Live Stripe (acct "JRC Dynamics", $14.99/149.90 · $27.99/279.90 AUD), webhook enabled, 8 single-use comp codes minted — testers redeem post-flip at /billing (no card at $0). **Canonical domain: www.jrcdynamics.com** (founder skipped the app. subdomain 2026-08-01; AUTH_URL/NEXT_PUBLIC_APP_URL/webhook all point at www, app. removed from the project). Still pending: Google OAuth origins for the domain; prod `SIGNUP_ACCESS_CODE` now redundant (grants sign-in only, paywall still applies). |

| **6** | Reprice + rename: Notebook $9.99 (1 q/day) · Race Engineer $19.99 (100 q/month), annual $99.90 / $199.90; `TIER_LABELS`; `resolveTierForPriceId` product-metadata fallback | ✅ **LIVE 2026-08-06.** Deployed the tier-resolution fix FIRST, then created the live prices, then moved the four Vercel `STRIPE_PRICE_*` vars and redeployed — that order is mandatory (see hazard above). Live products renamed to "JRC Trackside — Notebook" / "— Race Engineer". Old prices left active, so all 9 existing subscriptions keep their signed-up rate; verified against live Stripe that both superseded price ids still resolve via `product.metadata.tier` (5 on the old $279.90 annual → `pro`, 3 on the old $14.99 monthly → `standard`). `/join` and `/welcome` both serving the new figures, zero stale strings. No new comp codes minted (`--comp-codes=0`). |

Update this table as work lands — a spec is intent, not shipped code (`docs/NOT_YET_BUILT.md`).

## Launch runbook (founder-executed, in this order)

The code side is done and driven in test mode; going live is configuration. Order matters —
comp codes must reach testers BEFORE enforcement flips, or every tester lands on /billing.

0. **Domain (decided 2026-08-01): `app.jrcdynamics.com`.** DNS is on Cloudflare. Add the domain
   to the Vercel project (`vercel domains add` or dashboard), then in Cloudflare: CNAME `app` →
   `cname.vercel-dns.com`, **proxy OFF (grey cloud)** so Vercel can issue TLS. Update
   `AUTH_URL` + `NEXT_PUBLIC_APP_URL` to `https://app.jrcdynamics.com`; if Google OAuth is on,
   add the new origin + `/api/auth/callback/google` redirect in Google Console. Do this BEFORE
   comp codes go out so testers bookmark the final URL and magic links never break.
1. **Stripe live mode — one command:** put `STRIPE_SECRET_KEY_LIVE="sk_live_..."` in .env.local,
   then `npm run stripe:launch-live -- --origin=https://app.jrcdynamics.com --comp-codes=<N>`.
   Creates the four products/prices, the "Founders comp" coupon + N single-use codes, the live
   webhook endpoint, and prints the whole Vercel env block. Idempotent.
2. **Vercel env (Production):** paste the printed block — `STRIPE_SECRET_KEY` (live), four
   `STRIPE_PRICE_*` ids, `STRIPE_WEBHOOK_SECRET`, `AUTH_URL`, `NEXT_PUBLIC_APP_URL`. **Also
   verify `EMAIL_SERVER`/`EMAIL_FROM` are set and deliver** — a paid signup's magic link goes by
   email; without SMTP the webhook logs the link into Vercel logs and the buyer sees nothing.
   Leave `BILLING_ENFORCED` unset for now. Redeploy.
3. **Smoke the dark door:** visit `/welcome` and `/join` signed out on prod; buy Standard with a
   real card, confirm the magic-link email arrives and the account provisions; refund yourself in
   the Stripe dashboard.
4. **Comp the testers:** send each their code + the `/join` link. Watch subscriptions appear.
5. **Flip:** set `BILLING_ENFORCED=1`, redeploy. Spot-check: your admin account unaffected; a
   tester account entitled; an incognito visit to `/` gets the landing.
6. **Watch week one:** Stripe dashboard for failed payments/disputes, `topAiSpenders` for cap
   behaviour, and the "paid but no email" support case (webhook logs + Stripe event retries).

## Non-goals

| Not the goal | Why |
|---|---|
| A free tier | Every account is funded; the Engineer's marginal cost makes freeloaders the worst failure mode for a solo founder. |
| Open signup without payment | Even a paywalled empty shell reopens the spam/abuse surface and pollutes community aggregations. |
| A marketing site | One landing screen in-app. The demo is the pitch. |
| Per-visitor demo sandboxes | Real per-visitor writes + cleanup + live-AI abuse surface; the shared read-only account with capped live asks gets 90% of the value. |
