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

console.log("engineerChatContextTier.test.ts OK");
