/**
 * launch-live-stripe.ts — one-shot LIVE-mode Stripe setup for launch
 * (docs/MONETISATION_NORTH_STAR.md runbook, steps 1–2). Idempotent; re-run freely.
 *
 *   1. Put your LIVE secret key in .env.local as   STRIPE_SECRET_KEY_LIVE="sk_live_..."
 *      (separate var — the normal STRIPE_SECRET_KEY stays the test key; roll the live key in
 *      the Stripe dashboard after launch if you want it out of the file.)
 *   2. npm run stripe:launch-live -- --origin=https://app.jrcdynamics.com --comp-codes=8
 *
 * Does, in live mode:
 *   - products + prices: Standard $14.99/$149.90 · Pro $27.99/$279.90 AUD (same lookup keys as
 *     test; amount changes create a replacement price and transfer the key)
 *   - "Founders comp" 100%-off-forever coupon + N single-use promo codes (JRC-XXXXXX) — one per
 *     tester so a comp can be revoked individually by cancelling that subscription
 *   - webhook endpoint at <origin>/api/stripe/webhook with exactly the events the route handles
 *   - prints the complete Vercel env block to paste (price ids + whsec)
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const key = process.env.STRIPE_SECRET_KEY_LIVE;
if (!key?.startsWith("sk_live_")) {
  console.error(
    'STRIPE_SECRET_KEY_LIVE is not set (or not an sk_live_ key). Add it to .env.local:\n  STRIPE_SECRET_KEY_LIVE="sk_live_..."',
  );
  process.exit(1);
}
const origin = (argValue("origin") ?? "https://app.jrcdynamics.com").replace(/\/$/, "");
const compCodeCount = Math.max(0, Number(argValue("comp-codes") ?? 0) || 0);
const stripe = new Stripe(key);

const APP = "rc-engineer";
const TIERS = [
  {
    tier: "standard",
    productName: "RC Engineer — Standard",
    prices: [
      { envVar: "STRIPE_PRICE_STANDARD_MONTHLY", lookupKey: "rc_engineer_standard_monthly", interval: "month" as const, unitAmount: 1499 },
      { envVar: "STRIPE_PRICE_STANDARD_ANNUAL", lookupKey: "rc_engineer_standard_annual", interval: "year" as const, unitAmount: 14990 },
    ],
  },
  {
    tier: "pro",
    productName: "RC Engineer — Pro",
    prices: [
      { envVar: "STRIPE_PRICE_PRO_MONTHLY", lookupKey: "rc_engineer_pro_monthly", interval: "month" as const, unitAmount: 2799 },
      { envVar: "STRIPE_PRICE_PRO_ANNUAL", lookupKey: "rc_engineer_pro_annual", interval: "year" as const, unitAmount: 27990 },
    ],
  },
];

/** Exactly what src/app/api/stripe/webhook/route.ts handles. */
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

async function ensureProduct(tier: string, name: string): Promise<string> {
  const found = await stripe.products.search({
    query: `active:'true' AND metadata['app']:'${APP}' AND metadata['tier']:'${tier}'`,
  });
  if (found.data[0]) return found.data[0].id;
  const created = await stripe.products.create({ name, metadata: { app: APP, tier } });
  return created.id;
}

async function ensurePrice(
  productId: string,
  def: (typeof TIERS)[number]["prices"][number],
): Promise<string> {
  const existing = await stripe.prices.list({ lookup_keys: [def.lookupKey], limit: 1 });
  const current = existing.data[0];
  if (current && current.unit_amount === def.unitAmount) return current.id;
  const price = await stripe.prices.create({
    product: productId,
    currency: "aud",
    unit_amount: def.unitAmount,
    recurring: { interval: def.interval },
    lookup_key: def.lookupKey,
    ...(current ? { transfer_lookup_key: true } : {}),
    metadata: { app: APP },
  });
  return price.id;
}

async function ensureCompCoupon(): Promise<string> {
  // Coupons can't be searched by metadata; list and match by name.
  const coupons = await stripe.coupons.list({ limit: 100 });
  const found = coupons.data.find((c) => c.name === "Founders comp" && c.percent_off === 100);
  if (found) return found.id;
  const created = await stripe.coupons.create({
    percent_off: 100,
    duration: "forever",
    name: "Founders comp",
  });
  return created.id;
}

async function ensureWebhook(): Promise<{ url: string; secret: string | null }> {
  const url = `${origin}/api/stripe/webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 30 });
  const found = endpoints.data.find((e) => e.url === url);
  if (found) {
    // The signing secret is only revealed at creation. Keep the endpoint; tell the operator.
    return { url, secret: found.secret ?? null };
  }
  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: "RC Engineer paid door (created by launch-live-stripe.ts)",
  });
  return { url, secret: created.secret ?? null };
}

async function main() {
  console.log(`LIVE mode against ${origin}\n`);

  const envLines: string[] = [];
  for (const tier of TIERS) {
    const productId = await ensureProduct(tier.tier, tier.productName);
    for (const p of tier.prices) {
      const priceId = await ensurePrice(productId, p);
      console.log(`${tier.productName} — $${(p.unitAmount / 100).toFixed(2)} AUD/${p.interval}: ${priceId}`);
      envLines.push(`${p.envVar}=${priceId}`);
    }
  }

  const couponId = await ensureCompCoupon();
  console.log(`\nFounders comp coupon: ${couponId}`);
  if (compCodeCount > 0) {
    console.log(`Creating ${compCodeCount} single-use comp codes:`);
    for (let i = 0; i < compCodeCount; i++) {
      const code = `JRC-${randomBytes(3).toString("hex").toUpperCase()}`;
      const promo = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: couponId },
        code,
        max_redemptions: 1,
      });
      console.log(`  ${promo.code}`);
    }
    console.log("(one per tester — revoke a comp by cancelling that tester's subscription)");
  }

  const webhook = await ensureWebhook();
  console.log(`\nWebhook endpoint: ${webhook.url}`);
  if (webhook.secret) {
    envLines.push(`STRIPE_WEBHOOK_SECRET=${webhook.secret}`);
  } else {
    console.log(
      "  Endpoint already existed — Stripe only reveals the signing secret at creation.\n" +
        "  Dashboard → Developers → Webhooks → this endpoint → 'Reveal' the secret, or delete the\n" +
        "  endpoint and re-run this script to mint a fresh one.",
    );
    envLines.push("STRIPE_WEBHOOK_SECRET=<reveal in dashboard — see note above>");
  }

  console.log(`\n--- Vercel env (Production) — paste these, plus STRIPE_SECRET_KEY=<your sk_live key> ---`);
  console.log(envLines.join("\n"));
  console.log(`AUTH_URL=${origin}`);
  console.log(`NEXT_PUBLIC_APP_URL=${origin}`);
  console.log(`\nLeave BILLING_ENFORCED unset until comp codes are in testers' hands (runbook step 5).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
