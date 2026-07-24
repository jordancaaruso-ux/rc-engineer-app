/**
 * Run: `npm run test:stripe-sync`
 *
 * Locks the cancellation mapping that a live Billing Portal cancel exposed as a bug: flexible
 * billing schedules a cancel as `cancel_at` (timestamp) with `cancel_at_period_end` still false.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveSubscriptionSchedule } from "./stripeSubscriptionSync";

const PERIOD_END = 1787528110; // 2026-08-23T23:35:10Z
const CANCEL_AT = 1786000000; // earlier than PERIOD_END

test("renewing sub: no cancel, end = item period end", () => {
  const s = deriveSubscriptionSchedule({
    cancel_at: null,
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: PERIOD_END }] },
  });
  assert.equal(s.cancelAtPeriodEnd, false);
  assert.equal(s.currentPeriodEnd?.getTime(), PERIOD_END * 1000);
});

test("classic cancel: cancel_at_period_end flag is honoured", () => {
  const s = deriveSubscriptionSchedule({
    cancel_at: null,
    cancel_at_period_end: true,
    items: { data: [{ current_period_end: PERIOD_END }] },
  });
  assert.equal(s.cancelAtPeriodEnd, true);
  assert.equal(s.currentPeriodEnd?.getTime(), PERIOD_END * 1000);
});

test("flexible-billing cancel: cancel_at set with flag false still counts as cancelling", () => {
  const s = deriveSubscriptionSchedule({
    cancel_at: CANCEL_AT,
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: PERIOD_END }] },
  });
  assert.equal(s.cancelAtPeriodEnd, true);
  // The concrete cancel date wins over the period end.
  assert.equal(s.currentPeriodEnd?.getTime(), CANCEL_AT * 1000);
});

test("older API shape: top-level current_period_end is read when no items", () => {
  const s = deriveSubscriptionSchedule({ current_period_end: PERIOD_END });
  assert.equal(s.cancelAtPeriodEnd, false);
  assert.equal(s.currentPeriodEnd?.getTime(), PERIOD_END * 1000);
});

test("no dates present: currentPeriodEnd is null, not cancelling", () => {
  const s = deriveSubscriptionSchedule({});
  assert.equal(s.currentPeriodEnd, null);
  assert.equal(s.cancelAtPeriodEnd, false);
});
