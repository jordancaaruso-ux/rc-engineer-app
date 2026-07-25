/**
 * Pure entitlement logic — NO database, NO `server-only`, NO Next imports. Safe to unit-test
 * (`npm run test:entitlement`) and to import from anywhere. The DB-backed resolvers live in
 * `entitlement.ts`, mirroring the `authAdminLogic.ts` / `authAdmin.ts` split.
 *
 * Model: feature-gated tiers (paywall plan, 2026-07-23). Standard = the smart notebook; Pro adds
 * the heavy/premium features. The Engineer is available to BOTH tiers — the Standard-vs-Pro
 * difference is a usage cap (an AiUsageDaily budget), not a feature gate, so "engineer" is in both
 * feature sets.
 */

export type Tier = "none" | "standard" | "pro";

export type Feature =
  | "logging"
  | "review"
  | "compare"
  | "engineer"
  | "video"
  | "roll-center";

const STANDARD_FEATURES: Feature[] = ["logging", "review", "compare", "engineer"];
const PRO_FEATURES: Feature[] = [...STANDARD_FEATURES, "video", "roll-center"];

const TIER_FEATURES: Record<Tier, ReadonlySet<Feature>> = {
  none: new Set<Feature>(),
  standard: new Set(STANDARD_FEATURES),
  pro: new Set(PRO_FEATURES),
};

/** Does this tier unlock this feature? Pure table lookup. */
export function isFeatureEntitled(tier: Tier, feature: Feature): boolean {
  return TIER_FEATURES[tier].has(feature);
}

/**
 * Stripe subscription statuses that grant access. Everything else (canceled, past_due, incomplete,
 * unpaid, paused, …) does not.
 */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  return status != null && ACTIVE_STATUSES.has(status);
}

export type SubscriptionShape = {
  status: string;
  tier: string;
  currentPeriodEnd: Date | null;
};

/**
 * Grace window applied AFTER `currentPeriodEnd` before access is revoked.
 *
 * Without this, a paying customer loses access the instant their period ends and regains it only
 * when the renewal webhook lands — so one delayed or failed `customer.subscription.updated` locks
 * a payer out mid-race-weekend. Stripe's own dunning runs for days; matching that is strictly
 * safer than being stricter than the payment processor.
 *
 * This only ever extends a subscription that is STILL `active`/`trialing`. A `canceled` row is
 * rejected by the status check above and never reaches here, so this cannot resurrect a real
 * cancellation — at worst a user who cancels keeps access for a few extra days between the period
 * ending and Stripe's `canceled` webhook arriving.
 */
export const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Effective tier from a subscription row. `null` / inactive / expired-past-grace → "none". A row
 * whose `tier` string isn't exactly "pro" resolves to "standard" — fail-safe to the cheaper grant,
 * never accidentally to Pro.
 *
 * `graceMs` is a parameter (not an env read) to keep this function pure and unit-testable; pass 0
 * to assert the hard expiry boundary.
 */
export function deriveSubscriptionTier(
  sub: SubscriptionShape | null | undefined,
  now: Date,
  graceMs: number = SUBSCRIPTION_GRACE_MS,
): Tier {
  if (!sub) return "none";
  if (!isActiveSubscriptionStatus(sub.status)) return "none";
  if (
    sub.currentPeriodEnd &&
    sub.currentPeriodEnd.getTime() + Math.max(0, graceMs) <= now.getTime()
  ) {
    return "none";
  }
  return sub.tier === "pro" ? "pro" : "standard";
}

/**
 * Master enforcement switch. When not exactly "1", the paywall is DARK — enforcement off, every
 * authenticated user resolves to full (Pro) access. This is what keeps the app byte-for-byte
 * unchanged for existing users until the founder deliberately flips it on.
 */
export function isBillingEnforced(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.BILLING_ENFORCED === "1";
}
