import "server-only";
import { cache } from "react";
import Stripe from "stripe";
import type { Tier } from "@/lib/entitlementLogic";

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
 * a plan picker cannot render "$14.99/mo" — or compute the annual saving — from a price id alone.
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
 * Plans enriched with live Stripe amounts. Memoized per request; prices are configuration that
 * changes at most a few times a year, so this is a cheap read on a cold page.
 */
export const getPricePlansWithAmounts = cache(
  async function getPricePlansWithAmounts(): Promise<PricePlanWithAmount[]> {
    const plans = getPricePlans();
    if (!stripeConfigured() || plans.length === 0) {
      return plans.map((p) => ({ ...p, unitAmount: null, currency: null }));
    }
    const stripe = getStripe();
    return Promise.all(
      plans.map(async (plan) => {
        try {
          const price = await stripe.prices.retrieve(plan.priceId);
          return {
            ...plan,
            unitAmount: price.unit_amount ?? null,
            currency: price.currency ?? null,
          };
        } catch (error) {
          // A missing/archived price must not take down /billing — the paywall sends people here.
          console.error(`[stripe] could not load price ${plan.priceId}`, error);
          return { ...plan, unitAmount: null, currency: null };
        }
      }),
    );
  },
);

/** Map a Stripe price id back to our internal tier. Unknown → "standard" (fail-safe to cheaper). */
export function tierForPriceId(priceId: string | null | undefined): Tier {
  if (!priceId) return "standard";
  if (
    priceId === process.env[PRICE_ENV_KEYS.proMonthly] ||
    priceId === process.env[PRICE_ENV_KEYS.proAnnual]
  ) {
    return "pro";
  }
  return "standard";
}
