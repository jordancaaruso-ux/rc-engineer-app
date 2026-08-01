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
| **Tiers** | **Standard $14.99 · Pro $27.99 AUD/mo** (+ annual variants, price points set when the Stripe prices are created). Pro was raised from the earlier $24.99 sketch to keep margin over the AI pool. Standard = the smart notebook with a taste of the Engineer; Pro = the real Engineer tier + video + roll-center. |
| **Engineer caps** | **Standard 2 questions/day · Pro 300/month pool.** At the terra chat rate (~$0.055/answer) a drained Standard month costs ~$3.30, a drained Pro pool $16.50 — profitable even at max. The contrast is the pitch: "2 a day" vs "300 a month, use them whenever". Cap-hit copy must sell the upgrade, never read as a limit error. Pro needs a "remaining this month" meter. |
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

## Hazards

- **Grandfather vs comp codes.** Every current `AuthAllowedEmail` row resolves to free Pro forever
  while the grandfather branch exists. The locked decision is comps-via-codes, so at launch (Phase
  5) the grandfather branch retires and testers redeem their 100% codes. Until then the two
  mechanisms overlap harmlessly (enforcement is dark).
- **Webhook email delivery.** The magic-link send happens inside the webhook handler; a send
  failure 500s the event so Stripe retries (user creation is idempotent by email). "Paid but the
  email never arrived" is the support case — the success page tells them to check spam and offers
  the support address.
- **`.env.example` pricing comment is stale** — it still says Pro $24.99; real price set in Stripe
  is $27.99.

## Rollout

| Phase | Scope | Status |
|---|---|---|
| **0** | Founder interview → this doc | ✅ 2026-08-01 |
| **1** | Paid door: `/join`, public checkout, webhook provisioning + magic link, paid-subscriber sign-in gate | ✅ built + driven end-to-end in Stripe test mode 2026-08-01 (real checkout w/ test card → signed webhook → provisioned user, no allowlist row → magic link → welcome overlay on a fresh account) |
| **2** | Enforcement: shell gate (`requireCurrentUser` bounces unpaid → /billing; `/billing` uses `requireCurrentUserAllowUnpaid`), video + roll-center visible-but-locked via segment layouts + 402 API guards, Engineer caps (2/day · 300/mo pool, upsell cap-hit copy, body meter), lapsed-sub chat 402 | ✅ built + driven with `BILLING_ENFORCED=1` in dev 2026-08-01 (lapsed → /billing, Standard → locked panels + refused 3rd question, Pro → open + 300/mo meter) |
| **3** | Demo: snapshot/anonymize script, public `/demo`, read-only guard, pre-baked threads, capped live asks | ⬜ **deferred** (founder call 2026-08-01 — phases 4–5 first) |
| **4** | Landing page: public `/welcome` (brand treatment, value trio, live prices, Get started → `/join`); unauthenticated `/` lands there; no app chrome on public routes | ✅ built + driven 2026-08-01 |
| **5** | Launch prep: grandfather retired to admins-only, price script → $27.99 (immutable-price replacement w/ lookup-key transfer), `payment_method_collection: if_required` for $0 comps, JRC-TESTER 100% code driven end-to-end in test mode ($0 checkout, no card → webhook → active sub) | ✅ code + test-mode 2026-08-01 — **live flip is the runbook below, founder-executed** |

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
