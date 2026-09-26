/**
 * Founding member seats in Stripe (docs/MONETISATION_NORTH_STAR.md, "Founding seats"), shared by
 * `stripe-setup-prices.ts` (test) and `launch-live-stripe.ts` (live). Idempotent: the product is
 * matched by metadata, prices by lookup key, so re-running reuses what exists.
 *
 * One product, three prices:
 *   - one-off payments for each batch ($399, $499 AUD), amounts read from FOUNDING_BATCHES so
 *     the page, the checkout and Stripe can't disagree;
 *   - a $0 yearly price: the webhook puts each founder on a subscription to it, and that
 *     subscription is the seat every other surface reads.
 *
 * The product's metadata.app is `rc-engineer-founding` on purpose. Both setup scripts find the
 * three plan products by `metadata.app = rc-engineer` plus tier, and this product also carries
 * tier `pro` (so the seat resolves to Race Engineer); with the plain app stamp it would be
 * mistaken for Race Engineer's own product. It is also never added to the portal's plan-switch
 * list: a founder has nothing to switch to.
 *
 * A US$ or € amount already on a price can never be edited (Stripe: immutable). When the code's
 * amounts change, `--new-founding-prices` makes a new batch price and moves the lookup key to it;
 * the old price keeps working for whatever still points at it. Then put the new id in
 * STRIPE_PRICE_FOUNDING_<batch>, redeploy, and only then archive the old price.
 */
import type Stripe from "stripe";
// Relative, not `@/`: this runs under tsx outside the Next build. Both modules are pure.
import { PRODUCT_NAME } from "../src/lib/brand/brandNames";
import { FOUNDING_BATCHES } from "../src/lib/billing/foundingOfferLogic";

const FOUNDING_APP = "rc-engineer-founding";

type FoundingPriceDef = {
  envVar: string;
  lookupKey: string;
  unitAmount: number;
  /** Set for the $0 seat price only; the batch prices are one-off. */
  interval?: "year";
  /**
   * The price's own US$ and € amounts (Stripe `currency_options`), shown and charged to visitors
   * whose plans are priced in those currencies. Added once, never changed: Stripe refuses an edit to
   * an amount already on a price, so a different amount means a new price and new env vars
   * (`--new-founding-prices`).
   */
  currencyOptions: { usd: number; eur: number };
};

const PRICES: FoundingPriceDef[] = [
  ...FOUNDING_BATCHES.map((b) => ({
    envVar: `STRIPE_PRICE_FOUNDING_${b.batch}`,
    lookupKey: `rc_engineer_founding_batch_${b.batch}`,
    unitAmount: b.amountCents,
    currencyOptions: b.currencyAmounts,
  })),
  {
    envVar: "STRIPE_PRICE_FOUNDING_SEAT",
    lookupKey: "rc_engineer_founding_seat",
    unitAmount: 0,
    interval: "year",
    // $0 in every currency: a member whose plan bills in US$ must be able to hold a US$ seat.
    currencyOptions: { usd: 0, eur: 0 },
  },
];

async function ensureFoundingProduct(stripe: Stripe): Promise<string> {
  const name = `${PRODUCT_NAME} — Founding member`;
  const found = await stripe.products.search({
    query: `active:'true' AND metadata['app']:'${FOUNDING_APP}'`,
  });
  const existing = found.data[0];
  if (existing) {
    if (existing.name !== name) await stripe.products.update(existing.id, { name });
    return existing.id;
  }
  const created = await stripe.products.create({
    name,
    description: "Race Engineer for the life of the app. One payment, nothing renews.",
    metadata: { app: FOUNDING_APP, tier: "pro" },
  });
  return created.id;
}

async function ensureFoundingPrice(
  stripe: Stripe,
  productId: string,
  def: FoundingPriceDef,
  replaceChanged: boolean,
): Promise<string> {
  const existing = await stripe.prices.list({
    lookup_keys: [def.lookupKey],
    limit: 1,
    expand: ["data.currency_options"],
  });
  const current = existing.data[0];
  const sameShape =
    current &&
    current.unit_amount === def.unitAmount &&
    (current.recurring?.interval ?? undefined) === def.interval;
  const options = Object.entries(def.currencyOptions) as Array<["usd" | "eur", number]>;
  // US$/€ amounts the price already carries that differ from the code's: only a new price fixes them.
  const changed = options.filter(([c, amount]) => {
    const has = current?.currency_options?.[c]?.unit_amount;
    return has != null && has !== amount;
  });
  if (current && sameShape && !(replaceChanged && changed.length > 0)) {
    // Add any currency the price doesn't carry yet; one it already carries is never touched.
    const missing = options.filter(([c]) => current.currency_options?.[c]?.unit_amount == null);
    for (const [c, amount] of changed) {
      const has = current.currency_options?.[c]?.unit_amount;
      console.warn(
        `  ${def.lookupKey}: ${c} is ${has}, wanted ${amount}; Stripe can't change it (re-run with --new-founding-prices)`,
      );
    }
    if (missing.length > 0) {
      await stripe.prices.update(current.id, {
        currency_options: Object.fromEntries(missing.map(([c, amount]) => [c, { unit_amount: amount }])),
      });
      console.log(`  ${def.lookupKey}: added ${missing.map(([c, a]) => `${c} ${a}`).join(", ")}`);
    }
    return current.id;
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: "aud",
    unit_amount: def.unitAmount,
    currency_options: Object.fromEntries(options.map(([c, amount]) => [c, { unit_amount: amount }])),
    ...(def.interval ? { recurring: { interval: def.interval } } : {}),
    lookup_key: def.lookupKey,
    ...(current ? { transfer_lookup_key: true } : {}),
    metadata: { app: FOUNDING_APP },
  });
  if (current) {
    console.log(
      `  ${def.lookupKey}: ${price.id} replaces ${current.id}; archive the old one once nothing points at it`,
    );
  }
  return price.id;
}

/** Make (or find) the founding product and its prices; returns the env lines to paste. */
export async function ensureFoundingSeats(
  stripe: Stripe,
  opts: { replaceChanged?: boolean } = {},
): Promise<string[]> {
  const productId = await ensureFoundingProduct(stripe);
  const lines: string[] = [];
  for (const def of PRICES) {
    const priceId = await ensureFoundingPrice(stripe, productId, def, opts.replaceChanged ?? false);
    const what = def.interval
      ? `$0 AUD/${def.interval} (the seat)`
      : `$${(def.unitAmount / 100).toFixed(2)} AUD once (US$${(def.currencyOptions.usd / 100).toFixed(2)}, €${(def.currencyOptions.eur / 100).toFixed(2)})`;
    console.log(`${PRODUCT_NAME} — Founding member — ${what}: ${priceId}`);
    lines.push(`${def.envVar}=${priceId}`);
  }
  return lines;
}
