/**
 * Run: `npm run test:entitlement`
 *
 * Proves the grandfather/tier logic that keeps existing users unaffected and gates paid features.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBSCRIPTION_GRACE_MS,
  deriveSubscriptionTier,
  isActiveSubscriptionStatus,
  isBillingEnforced,
  isFeatureEntitled,
} from "@/lib/entitlementLogic";

const now = new Date("2026-07-24T00:00:00Z");
const future = new Date("2026-08-24T00:00:00Z");
const past = new Date("2026-06-24T00:00:00Z");

test("Standard unlocks the notebook features but not the premium ones", () => {
  assert.equal(isFeatureEntitled("standard", "logging"), true);
  assert.equal(isFeatureEntitled("standard", "review"), true);
  assert.equal(isFeatureEntitled("standard", "compare"), true);
  assert.equal(isFeatureEntitled("standard", "engineer"), true);
  assert.equal(isFeatureEntitled("standard", "video"), false);
  assert.equal(isFeatureEntitled("standard", "roll-center"), false);
});

test("Pro unlocks everything", () => {
  for (const f of ["logging", "review", "compare", "engineer", "video", "roll-center"] as const) {
    assert.equal(isFeatureEntitled("pro", f), true);
  }
});

test("none is entitled to nothing", () => {
  assert.equal(isFeatureEntitled("none", "logging"), false);
  assert.equal(isFeatureEntitled("none", "engineer"), false);
  assert.equal(isFeatureEntitled("none", "video"), false);
});

test("only active/trialing statuses grant access", () => {
  assert.equal(isActiveSubscriptionStatus("active"), true);
  assert.equal(isActiveSubscriptionStatus("trialing"), true);
  for (const s of ["canceled", "past_due", "incomplete", "unpaid", "paused", ""]) {
    assert.equal(isActiveSubscriptionStatus(s), false);
  }
  assert.equal(isActiveSubscriptionStatus(null), false);
  assert.equal(isActiveSubscriptionStatus(undefined), false);
});

test("tier derives from an active, unexpired subscription", () => {
  assert.equal(deriveSubscriptionTier(null, now), "none");
  assert.equal(
    deriveSubscriptionTier({ status: "active", tier: "pro", currentPeriodEnd: future }, now),
    "pro",
  );
  assert.equal(
    deriveSubscriptionTier({ status: "active", tier: "standard", currentPeriodEnd: future }, now),
    "standard",
  );
});

test("an unknown tier string fails safe to standard, never pro", () => {
  assert.equal(
    deriveSubscriptionTier({ status: "active", tier: "mystery", currentPeriodEnd: future }, now),
    "standard",
  );
});

test("canceled or expired subscriptions grant nothing", () => {
  assert.equal(
    deriveSubscriptionTier({ status: "canceled", tier: "pro", currentPeriodEnd: future }, now),
    "none",
  );
  assert.equal(
    deriveSubscriptionTier({ status: "active", tier: "pro", currentPeriodEnd: past }, now),
    "none",
  );
});

test("a just-ended active subscription keeps access through the grace window", () => {
  // A renewal webhook that is late (or fails and retries) must not lock a paying customer out
  // mid-race-weekend. Being stricter than Stripe's own dunning helps nobody.
  const justEnded = new Date(now.getTime() - 1_000);
  assert.equal(
    deriveSubscriptionTier({ status: "active", tier: "pro", currentPeriodEnd: justEnded }, now),
    "pro",
  );
  const pastGrace = new Date(now.getTime() - SUBSCRIPTION_GRACE_MS - 1_000);
  assert.equal(
    deriveSubscriptionTier({ status: "active", tier: "pro", currentPeriodEnd: pastGrace }, now),
    "none",
  );
});

test("grace never resurrects a canceled subscription", () => {
  const justEnded = new Date(now.getTime() - 1_000);
  assert.equal(
    deriveSubscriptionTier({ status: "canceled", tier: "pro", currentPeriodEnd: justEnded }, now),
    "none",
  );
});

test("graceMs 0 asserts the hard expiry boundary", () => {
  const justEnded = new Date(now.getTime() - 1_000);
  assert.equal(
    deriveSubscriptionTier(
      { status: "active", tier: "pro", currentPeriodEnd: justEnded },
      now,
      0,
    ),
    "none",
  );
});

test("an active subscription with no period end still grants", () => {
  assert.equal(
    deriveSubscriptionTier({ status: "active", tier: "pro", currentPeriodEnd: null }, now),
    "pro",
  );
});

test("BILLING_ENFORCED only enables enforcement when exactly '1'", () => {
  assert.equal(isBillingEnforced({ BILLING_ENFORCED: "1" }), true);
  assert.equal(isBillingEnforced({ BILLING_ENFORCED: "0" }), false);
  assert.equal(isBillingEnforced({ BILLING_ENFORCED: "true" }), false);
  assert.equal(isBillingEnforced({}), false);
});
