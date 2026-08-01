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
      // $27.99 (raised from the $24.99 sketch, founder-locked 2026-08-01) keeps ~40% margin over
      // a fully drained 300-question Engineer pool — see MONETISATION_NORTH_STAR.md.
      { envVar: "STRIPE_PRICE_PRO_MONTHLY", lookupKey: "rc_engineer_pro_monthly", interval: "month", unitAmount: 2799 },
      { envVar: "STRIPE_PRICE_PRO_ANNUAL", lookupKey: "rc_engineer_pro_annual", interval: "year", unitAmount: 27990 },
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
  const current = existing.data[0];
  if (current && current.unit_amount === def.unitAmount) return current.id;
  // Stripe prices are immutable: a changed amount (e.g. Pro $24.99 → $27.99, 2026-08-01) means a
  // NEW price that takes over the lookup key. The old price stays active so existing subscribers
  // keep renewing at what they signed up for; only new checkouts see the new id.
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
