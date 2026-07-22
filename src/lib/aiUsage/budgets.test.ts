/**
 * Run: `npm run test:ai-usage`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiUsageTimeZone,
  estimateCostUsd,
  evaluateAiBudget,
  modelRate,
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

test("ledger day zone is fixed by default, env-overridable", () => {
  assert.equal(aiUsageTimeZone({}), "Australia/Sydney");
  assert.equal(
    aiUsageTimeZone({ AI_USAGE_TIME_ZONE: "Europe/Berlin" }),
    "Europe/Berlin"
  );
});
