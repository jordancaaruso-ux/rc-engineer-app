/**
 * One-off: create the subscription products + prices in Stripe. Idempotent — products are matched
 * by metadata, prices by lookup_key, so re-running reuses what exists.
 *
 * Run (needs your TEST key `sk_test_...` in .env.local):
 *   npm run stripe:setup-prices
 *   (= npx dotenv-cli -e .env.local -- npx tsx scripts/stripe-setup-prices.ts)
 *
 * Prints the four price IDs as env lines to paste into .env.local. Uses AUD; amounts in cents.
 * Annual = 10x monthly (~2 months free).
 */
import Stripe from "stripe";
// Relative, not `@/` — this runs under tsx outside the Next build, so no path aliases.
// Both modules are pure by design, which is what makes them importable here.
import { PRODUCT_NAME, TIER_LABELS } from "../src/lib/brand/brandNames";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set — put your test key (sk_test_...) in .env.local.");
  process.exit(1);
}
if (!key.startsWith("sk_test_")) {
  console.error(`Refusing to run: STRIPE_SECRET_KEY is not a test key (expected sk_test_...). Got ${key.slice(0, 8)}…`);
  process.exit(1);
}
const stripe = new Stripe(key);

const APP = "rc-engineer";

type PriceDef = {
  envVar: string;
  lookupKey: string;
  interval: "month" | "year";
  unitAmount: number; // cents, AUD
};

type TierDef = {
  tier: "standard" | "pro";
  productName: string;
  prices: PriceDef[];
};

// Repriced 2026-08-06: $14.99/$27.99 → $9.99/$19.99, and Standard/Pro renamed to
// Notebook/Race Engineer. The tier IDS below are unchanged on purpose — they are the values in
// `Subscription.tier` and in each product's `metadata.tier`, and the webhook resolves entitlement
// through them. Only the labels moved. See docs/MONETISATION_NORTH_STAR.md.
const TIERS: TierDef[] = [
  {
    tier: "standard",
    productName: `${PRODUCT_NAME} — ${TIER_LABELS.standard}`,
    prices: [
      { envVar: "STRIPE_PRICE_STANDARD_MONTHLY", lookupKey: "rc_engineer_standard_monthly", interval: "month", unitAmount: 999 },
      { envVar: "STRIPE_PRICE_STANDARD_ANNUAL", lookupKey: "rc_engineer_standard_annual", interval: "year", unitAmount: 9990 },
    ],
  },
  {
    tier: "pro",
    productName: `${PRODUCT_NAME} — ${TIER_LABELS.pro}`,
    prices: [
      // $19.99 against a 100-question pool: ~US$12.58 net of Stripe versus US$4.83 of Engineer
      // spend at the measured $0.048/answer, and still profitable at US$9.73 if nothing caches.
      { envVar: "STRIPE_PRICE_PRO_MONTHLY", lookupKey: "rc_engineer_pro_monthly", interval: "month", unitAmount: 1999 },
      { envVar: "STRIPE_PRICE_PRO_ANNUAL", lookupKey: "rc_engineer_pro_annual", interval: "year", unitAmount: 19990 },
    ],
  },
];

async function ensureProduct(tier: string, name: string): Promise<string> {
  const found = await stripe.products.search({
    query: `active:'true' AND metadata['app']:'${APP}' AND metadata['tier']:'${tier}'`,
  });
  const existing = found.data[0];
  if (existing) {
    // Products are matched on metadata.tier, which never changes — so a renamed tier would
    // otherwise keep its old Stripe product name forever, and that name is what customers read on
    // their receipts and in the billing portal. Push the rename through.
    if (existing.name !== name) {
      console.log(`  product ${existing.id}: renaming "${existing.name}" → "${name}"`);
      await stripe.products.update(existing.id, { name });
    }
    return existing.id;
  }
  const created = await stripe.products.create({ name, metadata: { app: APP, tier } });
  return created.id;
}

async function ensurePrice(productId: string, def: PriceDef): Promise<string> {
  const existing = await stripe.prices.list({ lookup_keys: [def.lookupKey], limit: 1 });
  const current = existing.data[0];
  if (current && current.unit_amount === def.unitAmount) return current.id;
  // Stripe prices are immutable: a changed amount (e.g. Pro $27.99 → Race Engineer $19.99,
  // 2026-08-06) means a NEW price that takes over the lookup key. The old price stays active so
  // existing subscribers keep renewing at what they signed up for; only new checkouts see the new
  // id. That is also why the webhook must NOT identify a tier by matching the configured price ids
  // — see `resolveTierForPriceId`, which falls back to the product's metadata.tier precisely
  // because everyone who subscribed before a reprice still carries the superseded id.
  if (current) {
    console.log(
      `  ${def.lookupKey}: amount changed ${current.unit_amount} → ${def.unitAmount}, creating replacement price`,
    );
  }
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

async function main() {
  const envLines: string[] = [];
  for (const tier of TIERS) {
    const productId = await ensureProduct(tier.tier, tier.productName);
    for (const p of tier.prices) {
      const priceId = await ensurePrice(productId, p);
      const dollars = (p.unitAmount / 100).toFixed(2);
      console.log(`${tier.productName} — $${dollars} AUD / ${p.interval}: ${priceId}`);
      envLines.push(`${p.envVar}="${priceId}"`);
    }
  }
  console.log("\n--- paste into .env.local ---");
  console.log(envLines.join("\n"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
