/**
 * Run: `npx tsx src/lib/openAiRetry.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINEER_OPENAI_UNAVAILABLE_MESSAGE,
  computeOpenAiRetryDelayMs,
  engineerOpenAiCallTimeoutMs,
  engineerOpenAiUserMessage,
  isOpenAiQuotaExhaustedError,
  isOpenAiTpmRateLimitError,
  parseOpenAiRetryAfterMs,
} from "@/lib/openAiRetry";

test("parseOpenAiRetryAfterMs reads seconds with decimals", () => {
  const data = {
    error: {
      message:
        "Rate limit reached for gpt-4o ... Limit 30000, Used 15098, Requested 21051. Please try again in 12.298s.",
    },
  };
  assert.equal(parseOpenAiRetryAfterMs(data), 12_298);
});

test("parseOpenAiRetryAfterMs reads milliseconds", () => {
  const data = { error: { message: "Please try again in 388ms" } };
  assert.equal(parseOpenAiRetryAfterMs(data), 388);
});

test("parseOpenAiRetryAfterMs defaults when missing", () => {
  assert.equal(parseOpenAiRetryAfterMs(undefined), 1000);
  assert.equal(parseOpenAiRetryAfterMs({ error: { message: "other error" } }), 1000);
});

test("isOpenAiTpmRateLimitError detects TPM and 429", () => {
  assert.ok(
    isOpenAiTpmRateLimitError({
      error: { message: "Rate limit reached for gpt-4o in organization org tokens per min (TPM)" },
    })
  );
  assert.ok(isOpenAiTpmRateLimitError(undefined, 429));
  assert.ok(!isOpenAiTpmRateLimitError({ error: { message: "invalid_api_key" } }, 401));
});

test("computeOpenAiRetryDelayMs respects suggested wait and backoff", () => {
  const d0 = computeOpenAiRetryDelayMs(12_300, 0);
  assert.ok(d0 >= 12_350 && d0 <= 12_550);

  const d2 = computeOpenAiRetryDelayMs(500, 2);
  assert.ok(d2 >= 4050 && d2 <= 4250);
});

test("engineerOpenAiUserMessage maps rate limits to friendly copy", () => {
  assert.equal(
    engineerOpenAiUserMessage("Rate limit reached for gpt-4o ... tokens per min"),
    "Engineer is busy — try again in ~30s"
  );
  assert.equal(engineerOpenAiUserMessage("invalid_api_key"), "invalid_api_key");
});


test("out of credit is never treated as a rate limit, and never shown raw", () => {
  const quota = {
    error: {
      message:
        "You exceeded your current quota, please check your plan and billing details.",
      type: "insufficient_quota",
      code: "insufficient_quota",
    },
  };
  assert.ok(isOpenAiQuotaExhaustedError(quota));
  assert.ok(!isOpenAiTpmRateLimitError(quota, 429), "waiting never fixes an empty balance");
  assert.equal(
    engineerOpenAiUserMessage(quota.error.message),
    ENGINEER_OPENAI_UNAVAILABLE_MESSAGE,
  );
  assert.ok(!isOpenAiQuotaExhaustedError({ error: { message: "Rate limit reached ... tokens per min" } }));
});

test("the call timeout has a floor and an override", () => {
  const before = process.env.ENGINEER_OPENAI_TIMEOUT_MS;
  delete process.env.ENGINEER_OPENAI_TIMEOUT_MS;
  assert.equal(engineerOpenAiCallTimeoutMs(), 75_000);
  process.env.ENGINEER_OPENAI_TIMEOUT_MS = "180000";
  assert.equal(engineerOpenAiCallTimeoutMs(), 180_000);
  process.env.ENGINEER_OPENAI_TIMEOUT_MS = "10";
  assert.equal(engineerOpenAiCallTimeoutMs(), 75_000, "a nonsense value falls back");
  if (before === undefined) delete process.env.ENGINEER_OPENAI_TIMEOUT_MS;
  else process.env.ENGINEER_OPENAI_TIMEOUT_MS = before;
});

console.log("openAiRetry.test.ts OK");
