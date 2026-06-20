/**
 * Run: `npx tsx src/lib/openAiRetry.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeOpenAiRetryDelayMs,
  engineerOpenAiUserMessage,
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

console.log("openAiRetry.test.ts OK");
