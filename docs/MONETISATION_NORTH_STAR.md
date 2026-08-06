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
| **Demo** | **Shared read-only demo account** running as **Pro**, public route, seeded from **Jordan's real season, curated subset** (2–3 events, anonymized to a fictional driver, frozen snapshot — racers smell fake lap times). Pre-baked Engineer threads readable free; **1–2 live Engineer asks per visitor**, throttled per-IP + a global daily spend ceiling on the `AiUsageDaily` machinery, degrading to the pre-baked threads when tripped. |
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
| **3** | Demo: snapshot/anonymize script, public `/demo`, read-only guard, pre-baked threads, capped live asks | ⬜ **deferred** (founder call 2026-08-01 — phases 4–5 first) |
| **4** | Landing page: public `/welcome` (brand treatment, value trio, live prices, Get started → `/join`); unauthenticated `/` lands there; no app chrome on public routes | ✅ built + driven 2026-08-01 |
| **5** | Launch prep: grandfather retired to admins-only, price script → $27.99 (immutable-price replacement w/ lookup-key transfer), `payment_method_collection: if_required` for $0 comps, JRC-TESTER 100% code driven end-to-end in test mode ($0 checkout, no card → webhook → active sub) | ✅ **LAUNCHED 2026-08-01: BILLING_ENFORCED=1 live at www.jrcdynamics.com.** Live Stripe (acct "JRC Dynamics", $14.99/149.90 · $27.99/279.90 AUD), webhook enabled, 8 single-use comp codes minted — testers redeem post-flip at /billing (no card at $0). **Canonical domain: www.jrcdynamics.com** (founder skipped the app. subdomain 2026-08-01; AUTH_URL/NEXT_PUBLIC_APP_URL/webhook all point at www, app. removed from the project). Still pending: Google OAuth origins for the domain; prod `SIGNUP_ACCESS_CODE` now redundant (grants sign-in only, paywall still applies). |

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
