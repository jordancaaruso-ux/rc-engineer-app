/**
 * Pure mapping from a Stripe subscription to the renewal/cancellation state we persist.
 *
 * Kept dependency-free (no `server-only`, no SDK runtime import — the Stripe shape is described
 * structurally) so it is unit-testable in isolation, mirroring the `entitlement.ts` /
 * `entitlementLogic.ts` split. The webhook is the single caller; do not re-implement this mapping
 * elsewhere.
 */

/** The subset of a Stripe.Subscription this mapping reads. */
export type StripeSubscriptionLike = {
  cancel_at?: number | null;
  cancel_at_period_end?: boolean | null;
  /** Present at the top level in older API versions. */
  current_period_end?: number | null;
  /** Present at the item level in newer (flexible) billing. */
  items?: { data?: Array<{ current_period_end?: number | null }> };
};

export type SubscriptionSchedule = {
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/**
 * A pending cancellation surfaces two different ways depending on billing mode:
 *   - classic: the `cancel_at_period_end` flag is true; or
 *   - flexible billing / Billing Portal: a fixed `cancel_at` timestamp with the flag left false.
 * Treat either as "won't renew", and prefer the concrete `cancel_at` as the effective end so the
 * UI shows when access actually stops. `current_period_end` moved from the subscription (old API)
 * to the item (flexible), so read both.
 */
export function deriveSubscriptionSchedule(sub: StripeSubscriptionLike): SubscriptionSchedule {
  const periodEndUnix = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const cancelAtUnix = sub.cancel_at ?? null;
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end) || cancelAtUnix != null;
  const endUnix = cancelAtUnix ?? periodEndUnix;
  return {
    currentPeriodEnd: endUnix != null ? new Date(endUnix * 1000) : null,
    cancelAtPeriodEnd,
  };
}
