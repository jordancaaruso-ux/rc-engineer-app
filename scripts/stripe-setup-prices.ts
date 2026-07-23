/**
 * One-off: create the RC Engineer subscription products + prices in Stripe. Idempotent —
 * products are matched by metadata, prices by lookup_key, so re-running reuses what exists.
 *
 * Run (needs your TEST key `sk_test_...` in .env.local):
 *   npm run stripe:setup-prices
 *   (= npx dotenv-cli -e .env.local -- npx tsx scripts/stripe-setup-prices.ts)
 *
 * Prints the four price IDs as env lines to paste into .env.local. Uses AUD; amounts in cents.
 * Annual = 10x monthly (~2 months free).
 */
import Stripe from "stripe";

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

const TIERS: TierDef[] = [
  {
    tier: "standard",
    productName: "RC Engineer — Standard",
    prices: [
      { envVar: "STRIPE_PRICE_STANDARD_MONTHLY", lookupKey: "rc_engineer_standard_monthly", interval: "month", unitAmount: 1499 },
      { envVar: "STRIPE_PRICE_STANDARD_ANNUAL", lookupKey: "rc_engineer_standard_annual", interval: "year", unitAmount: 14990 },
    ],
  },
  {
    tier: "pro",
    productName: "RC Engineer — Pro",
    prices: [
      { envVar: "STRIPE_PRICE_PRO_MONTHLY", lookupKey: "rc_engineer_pro_monthly", interval: "month", unitAmount: 2499 },
      { envVar: "STRIPE_PRICE_PRO_ANNUAL", lookupKey: "rc_engineer_pro_annual", interval: "year", unitAmount: 24990 },
    ],
  },
];

async function ensureProduct(tier: string, name: string): Promise<string> {
  const found = await stripe.products.search({
    query: `active:'true' AND metadata['app']:'${APP}' AND metadata['tier']:'${tier}'`,
  });
  if (found.data[0]) return found.data[0].id;
  const created = await stripe.products.create({ name, metadata: { app: APP, tier } });
  return created.id;
}

async function ensurePrice(productId: string, def: PriceDef): Promise<string> {
  const existing = await stripe.prices.list({ lookup_keys: [def.lookupKey], limit: 1 });
  if (existing.data[0]) return existing.data[0].id;
  const price = await stripe.prices.create({
    product: productId,
    currency: "aud",
    unit_amount: def.unitAmount,
    recurring: { interval: def.interval },
    lookup_key: def.lookupKey,
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
