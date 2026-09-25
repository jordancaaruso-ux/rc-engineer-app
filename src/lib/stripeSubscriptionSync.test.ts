/**
 * Run: `npm run test:stripe-sync`
 *
 * Locks the cancellation mapping that a live Billing Portal cancel exposed as a bug: flexible
 * billing schedules a cancel as `cancel_at` (timestamp) with `cancel_at_period_end` still false.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveSubscriptionSchedule, keepStoredSubscription } from "./stripeSubscriptionSync";

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

// ── keepStoredSubscription (2026-09-25): one row per member, events for every subscription ──

const SEAT = "price_founding_seat";
const isSeat = (priceId: string | null | undefined) => priceId === SEAT;
const seatRow = { stripeSubscriptionId: "sub_seat", status: "active", priceId: SEAT };
const planRow = { stripeSubscriptionId: "sub_plan", status: "active", priceId: "price_pro_monthly" };

test("no stored row: every event applies", () => {
  assert.equal(keepStoredSubscription(null, { id: "sub_x", status: "canceled", priceId: null }, isSeat), false);
});

test("events about the stored subscription itself always apply", () => {
  // A refunded seat is cancelled; that must reach the row or the founder keeps access for free.
  assert.equal(keepStoredSubscription(seatRow, { id: "sub_seat", status: "canceled", priceId: SEAT }, isSeat), false);
  assert.equal(keepStoredSubscription(planRow, { id: "sub_plan", status: "past_due", priceId: "price_pro_monthly" }, isSeat), false);
});

test("a live founding seat ignores every other subscription, live or not", () => {
  // The plan a founder had is set to stop renewing: its update, then its end, must not lock them out.
  assert.equal(keepStoredSubscription(seatRow, { id: "sub_plan", status: "active", priceId: "price_pro_monthly" }, isSeat), true);
  assert.equal(keepStoredSubscription(seatRow, { id: "sub_plan", status: "canceled", priceId: "price_pro_monthly" }, isSeat), true);
});

test("an ended or unpaid subscription never replaces a different live one", () => {
  assert.equal(keepStoredSubscription(planRow, { id: "sub_old", status: "canceled", priceId: "price_std" }, isSeat), true);
  assert.equal(keepStoredSubscription(planRow, { id: "sub_old", status: "past_due", priceId: "price_std" }, isSeat), true);
});

test("a new live subscription replaces the stored one (a new plan, or a new seat)", () => {
  assert.equal(keepStoredSubscription(planRow, { id: "sub_new", status: "active", priceId: "price_std" }, isSeat), false);
  assert.equal(keepStoredSubscription(planRow, { id: "sub_seat", status: "active", priceId: SEAT }, isSeat), false);
});

test("a stored row that is no longer live can be replaced by anything", () => {
  const endedSeat = { ...seatRow, status: "canceled" };
  assert.equal(keepStoredSubscription(endedSeat, { id: "sub_plan", status: "active", priceId: "price_pro_monthly" }, isSeat), false);
  const lapsed = { ...planRow, status: "canceled" };
  assert.equal(keepStoredSubscription(lapsed, { id: "sub_other", status: "canceled", priceId: null }, isSeat), false);
});
