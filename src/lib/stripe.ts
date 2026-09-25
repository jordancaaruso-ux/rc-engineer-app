import "server-only";
import { cache } from "react";
import Stripe from "stripe";
import type { Tier } from "@/lib/entitlementLogic";
import {
  DEFAULT_PRICE_CURRENCY,
  amountInCurrency,
  type PriceCurrency,
} from "@/lib/billing/priceCurrencyLogic";

/** Lazily constructed so a missing key never crashes unrelated code at import time. */
let cached: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!cached) cached = new Stripe(key);
  return cached;
}

const PRICE_ENV_KEYS = {
  /** Starter is monthly only (docs/STARTER_TIER_PLAN.md): no annual key, by ruling. */
  starterMonthly: "STRIPE_PRICE_STARTER_MONTHLY",
  standardMonthly: "STRIPE_PRICE_STANDARD_MONTHLY",
  standardAnnual: "STRIPE_PRICE_STANDARD_ANNUAL",
  proMonthly: "STRIPE_PRICE_PRO_MONTHLY",
  proAnnual: "STRIPE_PRICE_PRO_ANNUAL",
} as const;

export type PricePlan = {
  tier: Tier;
  interval: "month" | "year";
  priceId: string;
  envKey: string;
};

/** The configured plans (env-driven, so adding a price is config, not a redeploy). */
export function getPricePlans(): PricePlan[] {
  const defs: Array<{ tier: Tier; interval: "month" | "year"; envKey: string }> = [
    { tier: "starter", interval: "month", envKey: PRICE_ENV_KEYS.starterMonthly },
    { tier: "standard", interval: "month", envKey: PRICE_ENV_KEYS.standardMonthly },
    { tier: "standard", interval: "year", envKey: PRICE_ENV_KEYS.standardAnnual },
    { tier: "pro", interval: "month", envKey: PRICE_ENV_KEYS.proMonthly },
    { tier: "pro", interval: "year", envKey: PRICE_ENV_KEYS.proAnnual },
  ];
  const plans: PricePlan[] = [];
  for (const d of defs) {
    const priceId = process.env[d.envKey];
    if (priceId) plans.push({ tier: d.tier, interval: d.interval, priceId, envKey: d.envKey });
  }
  return plans;
}

/**
 * A plan plus what it actually costs.
 *
 * `getPricePlans()` deliberately stays synchronous (checkout validates a client-supplied price id
 * against it, and that must not depend on a network call). The amount lives here instead, because
 * a plan picker cannot render "$9.99/mo" — or compute the annual saving — from a price id alone.
 *
 * `unitAmount` is in MINOR units (cents), exactly as Stripe reports it. Null means the lookup
 * failed or Stripe isn't configured; render those plans without a figure rather than crashing the
 * only page that can take the user's money.
 */
export type PricePlanWithAmount = PricePlan & {
  unitAmount: number | null;
  currency: string | null;
};

/**
 * The configured plans' Stripe prices, with every currency they carry. Memoized per request, and
 * with no argument on purpose: a page that shows plans in US$ and a founding band in A$ reads
 * Stripe once, not once per currency. Null for a price that couldn't be loaded.
 */
const loadPlanPrices = cache(async function loadPlanPrices(): Promise<(Stripe.Price | null)[]> {
  const stripe = getStripe();
  return Promise.all(
    getPricePlans().map(async (plan) => {
      try {
        return await stripe.prices.retrieve(plan.priceId, { expand: ["currency_options"] });
      } catch (error) {
        // A missing/archived price must not take down /billing — the paywall sends people here.
        console.error(`[stripe] could not load price ${plan.priceId}`, error);
        return null;
      }
    }),
  );
});

/**
 * Plans enriched with live Stripe amounts. Prices are configuration that changes at most a few
 * times a year, so this is a cheap read on a cold page.
 *
 * `wanted` is the visitor's currency (`priceCurrencyLogic.ts`). It is all or nothing: unless every
 * plan's price carries an amount in that currency, every plan comes back in AUD, so one page can
 * never mix "$12.99 USD" with "$9.99 AUD". Checkout reads this same answer, so the currency a page
 * shows is the one Stripe charges.
 */
export async function getPricePlansWithAmounts(
  wanted: PriceCurrency = DEFAULT_PRICE_CURRENCY
): Promise<PricePlanWithAmount[]> {
  const plans = getPricePlans();
  if (!stripeConfigured() || plans.length === 0) {
    return plans.map((p) => ({ ...p, unitAmount: null, currency: null }));
  }
  const prices = await loadPlanPrices();
  const everyPriceHasIt = prices.every(
    (price) => price != null && amountInCurrency(price, wanted).currency === wanted
  );
  const currency = everyPriceHasIt ? wanted : DEFAULT_PRICE_CURRENCY;
  return plans.map((plan, i) => {
    const price = prices[i];
    if (!price) return { ...plan, unitAmount: null, currency: null };
    const shown = amountInCurrency(price, currency);
    return { ...plan, unitAmount: shown.unitAmount, currency: shown.currency };
  });
}

/**
 * The currency to hand Checkout for this price and visitor: the one their page showed, read from
 * the same all-or-nothing answer. Only USD and EUR are ever passed. An AUD session is left to
 * Stripe, whose Adaptive Pricing may still convert it into the visitor's own money; it never
 * touches a currency the price carries its own amount in.
 */
export async function checkoutCurrencyFor(
  priceId: string,
  wanted: PriceCurrency
): Promise<"usd" | "eur" | undefined> {
  if (wanted === DEFAULT_PRICE_CURRENCY) return undefined;
  const plans = await getPricePlansWithAmounts(wanted);
  const shown = plans.find((p) => p.priceId === priceId)?.currency;
  return shown === "usd" || shown === "eur" ? shown : undefined;
}

/**
 * Map a Stripe price id back to our internal tier, by matching the CURRENTLY CONFIGURED price ids.
 * Unknown → null, meaning "these env vars can't answer" — never a tier guess. See
 * `resolveTierForPriceId` for why that distinction matters.
 */
function tierFromEnvPriceId(priceId: string): Tier | null {
  if (
    priceId === process.env[PRICE_ENV_KEYS.proMonthly] ||
    priceId === process.env[PRICE_ENV_KEYS.proAnnual]
  ) {
    return "pro";
  }
  if (
    priceId === process.env[PRICE_ENV_KEYS.standardMonthly] ||
    priceId === process.env[PRICE_ENV_KEYS.standardAnnual]
  ) {
    return "standard";
  }
  if (priceId === process.env[PRICE_ENV_KEYS.starterMonthly]) {
    return "starter";
  }
  return null;
}

/**
 * The tier a price grants — the authority for what a paying member gets.
 *
 * This USED to be a bare env-id comparison that fell back to "standard". That fallback is a
 * downgrade bomb the moment prices change: Stripe prices are immutable, so a repricing creates NEW
 * ids while every existing subscriber keeps paying against the OLD one. Their next routine
 * `invoice.paid` sync would find no env match and silently move them to the cheap tier — for Pro
 * members and comped testers alike, with no error anywhere and no way to notice but a complaint.
 *
 * So the env map is only a fast path (the common case: a current subscriber, no network call), and
 * a miss falls through to the price's PRODUCT metadata, which both setup scripts stamp with
 * `metadata.tier` and which Stripe carries forward across every future price. Only when Stripe
 * itself can't answer do we fail safe to "standard" — cheaper is the safe direction to be wrong in,
 * but it must be the last resort rather than the default.
 */
export async function resolveTierForPriceId(priceId: string | null | undefined): Promise<Tier> {
  if (!priceId) return "standard";
  const fromEnv = tierFromEnvPriceId(priceId);
  if (fromEnv) return fromEnv;
  if (!stripeConfigured()) return "standard";
  try {
    const price = await getStripe().prices.retrieve(priceId, { expand: ["product"] });
    const product = price.product;
    // A deleted product still resolves as `{ id, deleted: true }` with no metadata.
    const tier =
      typeof product === "object" && product && "metadata" in product
        ? product.metadata?.tier
        : undefined;
    if (tier === "pro" || tier === "standard" || tier === "starter") return tier;
    console.error(`[stripe] price ${priceId} has no usable product metadata.tier — using standard`);
  } catch (error) {
    // Never throw here: this runs inside the webhook, and a Stripe blip must not wedge the event.
    console.error(`[stripe] could not resolve tier for price ${priceId}`, error);
  }
  return "standard";
}
