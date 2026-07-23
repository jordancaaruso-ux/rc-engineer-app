import "server-only";
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
