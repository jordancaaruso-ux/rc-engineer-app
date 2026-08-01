/**
 * Run: `npm run test:ai-usage`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiUsageTimeZone,
  applyEngineerTierBudget,
  estimateCostUsd,
  evaluateAiBudget,
  modelRate,
  remainingMonthlyCalls,
  resolveAiBudget,
  type AiBudget,
} from "@/lib/aiUsage/budgets";

const budget: AiBudget = { dailyCalls: 10, dailyCostUsd: 2, monthlyCostUsd: 20 };

const clear = { budget, featureCallsToday: 0, costTodayUsd: 0, costMonthUsd: 0 };

test("known models price from the table", () => {
  assert.deepEqual(modelRate("gpt-4o-mini"), { input: 0.15, output: 0.6 });
  assert.deepEqual(modelRate("GPT-4O"), { input: 2.5, output: 10 });
});

test("dated snapshots price as their longest matching base model", () => {
  // must resolve to gpt-4o-mini, not the shorter gpt-4o prefix
  assert.deepEqual(modelRate("gpt-4o-mini-2024-07-18"), { input: 0.15, output: 0.6 });
  assert.deepEqual(modelRate("gpt-4o-2024-11-20"), { input: 2.5, output: 10 });
});

test("the shipping Engineer model prices at its real rate, not gpt-5's", () => {
  // Regression: this row said 1.25/10 (gpt-5's rate) until 2026-07-31, so every Engineer answer
  // was costed ~4x under and the daily cap let ~4x the intended spend through.
  assert.deepEqual(modelRate("gpt-5.5"), { input: 5, output: 30 });
  assert.deepEqual(modelRate("gpt-5"), { input: 1.25, output: 10 });
  // gpt-5.5-pro is 6x gpt-5.5 — it must not price off the shorter "gpt-5.5" prefix.
  assert.deepEqual(modelRate("gpt-5.5-pro"), { input: 30, output: 180 });
});

test("each gpt-5.6 tier prices off its own row", () => {
  // The three tiers differ by 25x on input. Longest-prefix matching is what keeps them apart —
  // a single bare "gpt-5.6" row would price luna at sol's rate and terra at neither's.
  assert.deepEqual(modelRate("gpt-5.6-sol"), { input: 5, output: 30 });
  assert.deepEqual(modelRate("gpt-5.6-terra"), { input: 2, output: 12 });
  assert.deepEqual(modelRate("gpt-5.6-luna"), { input: 0.2, output: 1.2 });
  // Dated snapshots still resolve to their tier, not to the bare 5.6 row.
  assert.deepEqual(modelRate("gpt-5.6-luna-2026-07-09"), { input: 0.2, output: 1.2 });
  // An untiered 5.6 must not fall through to the "gpt-5" prefix and under-count 4x.
  assert.deepEqual(modelRate("gpt-5.6"), { input: 5, output: 30 });
});

test("unknown models fall back to the expensive rate, never to free", () => {
  const rate = modelRate("some-future-model");
  assert.equal(rate.input, 5);
  assert.equal(rate.output, 20);
  assert.ok(estimateCostUsd({ model: "some-future-model", promptTokens: 1000, completionTokens: 0 }) > 0);
});

test("cost is per million tokens, split by input and output", () => {
  const cost = estimateCostUsd({
    model: "gpt-4o",
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
  });
  assert.equal(cost, 12.5);
  assert.equal(estimateCostUsd({ model: "gpt-4o", promptTokens: 0, completionTokens: 0 }), 0);
});

test("negative token counts cannot create negative cost", () => {
  assert.equal(
    estimateCostUsd({ model: "gpt-4o", promptTokens: -500, completionTokens: -500 }),
    0
  );
});

test("a clear account passes", () => {
  assert.deepEqual(evaluateAiBudget(clear), { ok: true });
});

test("each limit blocks with its own reason", () => {
  const calls = evaluateAiBudget({ ...clear, featureCallsToday: 10 });
  assert.equal(calls.ok, false);
  assert.equal(calls.ok === false && calls.reason, "daily-calls");

  const daily = evaluateAiBudget({ ...clear, costTodayUsd: 2 });
  assert.equal(daily.ok, false);
  assert.equal(daily.ok === false && daily.reason, "daily-cost");

  const monthly = evaluateAiBudget({ ...clear, costMonthUsd: 20 });
  assert.equal(monthly.ok, false);
  assert.equal(monthly.ok === false && monthly.reason, "monthly-cost");
});

test("limits are inclusive — landing exactly on the cap blocks the next call", () => {
  assert.equal(evaluateAiBudget({ ...clear, featureCallsToday: 9 }).ok, true);
  assert.equal(evaluateAiBudget({ ...clear, featureCallsToday: 10 }).ok, false);
});

test("over-budget messages are driver-facing, not operator-facing", () => {
  const v = evaluateAiBudget({ ...clear, costTodayUsd: 99 });
  assert.equal(v.ok, false);
  if (v.ok === false) {
    assert.match(v.message, /allowance/i);
    assert.doesNotMatch(v.message, /usd|token|budget|quota/i);
  }
});

test("env overrides the defaults; junk values fall back", () => {
  const overridden = resolveAiBudget("engineer-chat", {
    AI_DAILY_CALL_LIMIT: "5",
    AI_DAILY_COST_LIMIT_USD: "1.5",
    AI_MONTHLY_COST_LIMIT_USD: "9",
  });
  assert.deepEqual(overridden, { dailyCalls: 5, dailyCostUsd: 1.5, monthlyCostUsd: 9 });

  const junk = resolveAiBudget("engineer-chat", {
    AI_DAILY_CALL_LIMIT: "not-a-number",
    AI_DAILY_COST_LIMIT_USD: "-3",
  });
  assert.equal(junk.dailyCalls, 60);
  assert.equal(junk.dailyCostUsd, 3);
});

test("features get their own per-day call allowance", () => {
  const empty = {};
  assert.equal(resolveAiBudget("engineer-chat", empty).dailyCalls, 60);
  assert.equal(resolveAiBudget("setup-extract", empty).dailyCalls, 25);
});

test("cached input tokens are charged at a fraction of the input rate", () => {
  const base = { model: "gpt-4o", promptTokens: 1_000_000, completionTokens: 0 };
  assert.equal(estimateCostUsd(base), 2.5);
  assert.equal(estimateCostUsd({ ...base, cachedPromptTokens: 1_000_000 }), 0.25);
  assert.equal(estimateCostUsd({ ...base, cachedPromptTokens: 500_000 }), 1.375);
});

test("a bogus cached count cannot manufacture a discount", () => {
  const base = { model: "gpt-4o", promptTokens: 1_000, completionTokens: 0 };
  // Cached can never exceed the prompt itself...
  assert.equal(
    estimateCostUsd({ ...base, cachedPromptTokens: 999_999 }),
    estimateCostUsd({ ...base, cachedPromptTokens: 1_000 })
  );
  assert.ok(estimateCostUsd({ ...base, cachedPromptTokens: 999_999 }) > 0);
  // ...and a negative count is ignored, not treated as a surcharge.
  assert.equal(estimateCostUsd({ ...base, cachedPromptTokens: -5 }), estimateCostUsd(base));
});

test("no monthly call quota by default — today's behaviour is unchanged", () => {
  assert.equal(resolveAiBudget("engineer-chat", {}).monthlyCalls, undefined);
  assert.equal(evaluateAiBudget({ ...clear, featureCallsMonth: 10_000 }).ok, true);
});

test("a monthly call quota blocks with its own reason and is inclusive", () => {
  const capped: AiBudget = { ...budget, monthlyCalls: 15 };
  assert.equal(evaluateAiBudget({ ...clear, budget: capped, featureCallsMonth: 14 }).ok, true);
  const v = evaluateAiBudget({ ...clear, budget: capped, featureCallsMonth: 15 });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.reason, "monthly-calls");
  if (v.ok === false) {
    // Same driver-facing rule as the other messages: no operator vocabulary.
    assert.doesNotMatch(v.message, /usd|token|budget|quota/i);
  }
});

test("the visible monthly allowance is reported ahead of the invisible dollar brakes", () => {
  const capped: AiBudget = { ...budget, monthlyCalls: 15 };
  const v = evaluateAiBudget({
    ...clear,
    budget: capped,
    featureCallsMonth: 15,
    costTodayUsd: 99,
  });
  assert.equal(v.ok === false && v.reason, "monthly-calls");
});

test("remainingMonthlyCalls counts down, floors at zero, null when unlimited", () => {
  assert.equal(remainingMonthlyCalls(budget, 5), null);
  const capped: AiBudget = { ...budget, monthlyCalls: 15 };
  assert.equal(remainingMonthlyCalls(capped, 3), 12);
  assert.equal(remainingMonthlyCalls(capped, 15), 0);
  assert.equal(remainingMonthlyCalls(capped, 99), 0);
});

test("AI_MONTHLY_CALL_LIMIT sets the quota; junk leaves it unlimited", () => {
  assert.equal(resolveAiBudget("engineer-chat", { AI_MONTHLY_CALL_LIMIT: "15" }).monthlyCalls, 15);
  assert.equal(
    resolveAiBudget("engineer-chat", { AI_MONTHLY_CALL_LIMIT: "nope" }).monthlyCalls,
    undefined
  );
});

test("ledger day zone is fixed by default, env-overridable", () => {
  assert.equal(aiUsageTimeZone({}), "Australia/Sydney");
  assert.equal(
    aiUsageTimeZone({ AI_USAGE_TIME_ZONE: "Europe/Berlin" }),
    "Europe/Berlin"
  );
});

test("Standard tier: 2 questions a day, and the cap-hit line sells Pro", () => {
  const shaped = applyEngineerTierBudget(budget, "standard");
  assert.equal(shaped.dailyCalls, 2);
  assert.equal(shaped.monthlyCalls, undefined);
  // Dollar brakes are untouched — the tier changes the allowance, not the abuse ceiling.
  assert.equal(shaped.dailyCostUsd, budget.dailyCostUsd);
  assert.equal(evaluateAiBudget({ ...clear, budget: shaped, featureCallsToday: 1 }).ok, true);
  const v = evaluateAiBudget({ ...clear, budget: shaped, featureCallsToday: 2 });
  assert.equal(v.ok === false && v.reason, "daily-calls");
  if (v.ok === false) assert.match(v.message, /Pro/);
});

test("Pro tier: 300-a-month pool beside the base daily burst brake", () => {
  const shaped = applyEngineerTierBudget(budget, "pro");
  assert.equal(shaped.monthlyCalls, 300);
  assert.equal(shaped.dailyCalls, budget.dailyCalls);
  assert.equal(evaluateAiBudget({ ...clear, budget: shaped, featureCallsMonth: 299 }).ok, true);
  const v = evaluateAiBudget({ ...clear, budget: shaped, featureCallsMonth: 300 });
  assert.equal(v.ok === false && v.reason, "monthly-calls");
  // Pro's cap-hit line must NOT upsell — there is nothing above Pro to sell.
  if (v.ok === false) assert.doesNotMatch(v.message, /upgrade/i);
});

test("a Standard cap never widens an operator-tightened daily brake", () => {
  const tightened: AiBudget = { ...budget, dailyCalls: 1 };
  assert.equal(applyEngineerTierBudget(tightened, "standard").dailyCalls, 1);
});
