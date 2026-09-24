/**
 * Pure entitlement logic — NO database, NO `server-only`, NO Next imports. Safe to unit-test
 * (`npm run test:entitlement`) and to import from anywhere. The DB-backed resolvers live in
 * `entitlement.ts`, mirroring the `authAdminLogic.ts` / `authAdmin.ts` split.
 *
 * Model: feature-gated tiers (paywall plan, 2026-07-23; third tier 2026-09-09). Starter = the
 * notebook that only remembers the last fifteen runs and has no Engineer. Standard = the smart
 * notebook; Pro adds the heavy/premium features. The Engineer is available to Standard AND Pro —
 * the Standard-vs-Pro difference is a usage cap (an AiUsageDaily budget), not a feature gate, so
 * "engineer" is in both of those feature sets and absent from Starter's
 * (docs/STARTER_TIER_PLAN.md).
 *
 * The Tools benches are not the notebook (founder call 2026-09-15): lap time analysis
 * (`lap-analysis`, the `/laps/analysis` room that reads any timing sheet) and the Geometry Lab
 * (`roll-center`) are both Pro's, so Starter's and Standard's Tools tab is two locked benches.
 * Lap time analysis started at Standard and moved up to Pro (founder call 2026-09-24): the
 * sessions you drove are the notebook's, reading anyone else's is Race Engineer's. Reading your
 * own run's laps, with its race and its teammates, is `review`, and every plan keeps it.
 */

export type Tier = "none" | "starter" | "standard" | "pro";

/** The tiers a member can actually hold — `Tier` minus the lapsed/unsubscribed state. */
export type PaidTier = Exclude<Tier, "none">;

/** Cheapest first — the order `lowestTierWithFeature` walks. */
export const PAID_TIERS: readonly PaidTier[] = ["starter", "standard", "pro"];

export type Feature =
  | "logging"
  | "review"
  | "compare"
  | "lap-analysis"
  | "engineer"
  | "video"
  | "roll-center";

const STARTER_FEATURES: Feature[] = ["logging", "review", "compare"];
const STANDARD_FEATURES: Feature[] = [...STARTER_FEATURES, "engineer"];
const PRO_FEATURES: Feature[] = [...STANDARD_FEATURES, "lap-analysis", "video", "roll-center"];

const TIER_FEATURES: Record<Tier, ReadonlySet<Feature>> = {
  none: new Set<Feature>(),
  starter: new Set(STARTER_FEATURES),
  standard: new Set(STANDARD_FEATURES),
  pro: new Set(PRO_FEATURES),
};

/** Does this tier unlock this feature? Pure table lookup. */
export function isFeatureEntitled(tier: Tier, feature: Feature): boolean {
  return TIER_FEATURES[tier].has(feature);
}

/**
 * The cheapest tier that includes a feature. Not the name a locked door sells: that is
 * `upgradeTierFor`, which differs for the Engineer.
 */
export function lowestTierWithFeature(feature: Feature): PaidTier {
  for (const tier of PAID_TIERS) {
    if (TIER_FEATURES[tier].has(feature)) return tier;
  }
  return "pro";
}

/**
 * The tier a locked surface sells for a feature: what "Included in …", "Upgrade to …" and a 402
 * refusal name. The cheapest tier that has it, except the Engineer: Notebook's one question a day
 * is a taste, not the feature, so a locked Engineer points at Race Engineer (founder call
 * 2026-09-15). Gating never reads this; `isFeatureEntitled` decides who gets in.
 */
export function upgradeTierFor(feature: Feature): PaidTier {
  if (feature === "engineer") return "pro";
  return lowestTierWithFeature(feature);
}

/**
 * How many of a Starter member's runs stay visible (docs/STARTER_TIER_PLAN.md). Fifteen runs is
 * a race weekend plus a club night (ten at 2026-09-09, raised to fifteen by founder call
 * 2026-09-15); the sixteenth run hides the first. Hidden, never deleted — `applyRunWindow`
 * (src/lib/runs/runWindow.ts) stamps `Run.hiddenByPlanAt`, and an upgrade clears it. Lives here
 * rather than beside the routine so the join page can print the number without importing a
 * server-only module.
 */
export const STARTER_RUN_WINDOW = 15;

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
 * Effective tier from a subscription row. `null` / inactive / expired-past-grace → "none". The
 * `tier` string has to match an id exactly ("pro", "starter"); anything else resolves to
 * "standard" — fail-safe to the cheaper of the two original grants, never accidentally to Pro.
 * Starter is cheaper still, but a genuinely unknown string is a config fault, not a Starter
 * purchase, and hiding a paying member's runs is the wrong way to be wrong.
 *
 * The flip side (docs/STARTER_TIER_PLAN.md, deploy order): code that does not know "starter"
 * hands a Starter buyer full Notebook. Ship this before the live Starter price exists.
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
  if (sub.tier === "pro") return "pro";
  if (sub.tier === "starter") return "starter";
  return "standard";
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
