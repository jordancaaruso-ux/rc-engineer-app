/**
 * Run: `npx tsx src/lib/engineerPhase5/engineerChatContextTier.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  engineerChatContextTier,
  engineerChatNeedsDeepContext,
} from "@/lib/engineerPhase5/engineerChatContextTier";

const tier = (lastUserMessage: string | undefined, runId = "", compareRunId = "") =>
  engineerChatContextTier({ lastUserMessage, runId, compareRunId });

/**
 * The regression this whole 2026-07-28 rework exists to prevent. Each of these is a real
 * driver with a real problem who cannot name it in setup vocabulary. Under the old tier
 * they were routed to a cheap model on thin context, with a prompt that told it to ask
 * for a focused run — so the people who needed the Engineer most got a form back.
 */
test("a driver who cannot name the problem still gets the full engineer path", () => {
  for (const msg of [
    "doesn't feel right",
    "I'm not happy with it",
    "where would you start?",
    "car is rubbish today",
    "help",
    "what should I do next?",
  ]) {
    assert.equal(tier(msg), "full", `expected full tier for: ${msg}`);
  }
});

test("only a recognised lap-history question with no run in focus takes the lookup path", () => {
  assert.equal(tier("what's my best lap at Kingston?"), "lookup");
  // Same question with a run focused: they are looking AT a run, so advice is on the table.
  assert.equal(tier("what's my best lap at Kingston?", "run1"), "full");
});

test("a situational hint never lands on the lookup prompt", () => {
  assert.equal(
    engineerChatContextTier({
      lastUserMessage: "what's my best lap at Kingston?",
      runId: "",
      compareRunId: "",
      mode: "quick",
    }),
    "full"
  );
});

test("unrecognised input defaults to full, never to the cheap shape", () => {
  assert.equal(tier(undefined), "full");
  assert.equal(tier(""), "full");
  assert.equal(tier("asdfgh"), "full");
});

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
