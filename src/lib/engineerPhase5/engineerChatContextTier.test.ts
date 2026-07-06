/**
 * Run: `npx tsx src/lib/engineerPhase5/engineerChatContextTier.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { engineerChatNeedsDeepContext } from "@/lib/engineerPhase5/engineerChatContextTier";

test("run id forces deep context", () => {
  assert.equal(
    engineerChatNeedsDeepContext({ lastUserMessage: "hi", runId: "r1", compareRunId: "" }),
    true
  );
});

test("setup keywords trigger deep context", () => {
  assert.equal(
    engineerChatNeedsDeepContext({
      lastUserMessage: "should I add front camber?",
      runId: "",
      compareRunId: "",
    }),
    true
  );
});

test("short chit-chat stays light", () => {
  assert.equal(
    engineerChatNeedsDeepContext({ lastUserMessage: "hello", runId: "", compareRunId: "" }),
    false
  );
});

test("handling vocabulary triggers deep context (pushing / loose / corner)", () => {
  assert.equal(
    engineerChatNeedsDeepContext({
      lastUserMessage: "Car is pushing mid-corner on my last run. 10 minutes until the next one - what do I do?",
      runId: "",
      compareRunId: "",
    }),
    true
  );
  assert.equal(
    engineerChatNeedsDeepContext({
      lastUserMessage: "the rear feels loose on exit",
      runId: "",
      compareRunId: "",
    }),
    true
  );
});

test("quick and deep modes force deep context even without setup keywords", () => {
  assert.equal(
    engineerChatNeedsDeepContext({
      lastUserMessage: "car felt weird today, thoughts?",
      runId: "",
      compareRunId: "",
      mode: "quick",
    }),
    true
  );
  assert.equal(
    engineerChatNeedsDeepContext({
      lastUserMessage: "car felt weird today, thoughts?",
      runId: "",
      compareRunId: "",
      mode: "deep",
    }),
    true
  );
  assert.equal(
    engineerChatNeedsDeepContext({
      lastUserMessage: "car felt weird today, thoughts?",
      runId: "",
      compareRunId: "",
      mode: "normal",
    }),
    false
  );
});

test("lap-history questions stay light even in quick mode", () => {
  assert.equal(
    engineerChatNeedsDeepContext({
      lastUserMessage: "what's my best lap at Keilor?",
      runId: "",
      compareRunId: "",
      mode: "quick",
    }),
    false
  );
});

console.log("engineerChatContextTier.test.ts OK");
