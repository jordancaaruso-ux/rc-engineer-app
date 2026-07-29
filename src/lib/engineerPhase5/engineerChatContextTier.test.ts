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

const deep = (lastUserMessage: string | undefined, runId = "", compareRunId = "") =>
  engineerChatNeedsDeepContext({ lastUserMessage, runId, compareRunId });

/**
 * The regression the 2026-07-28 rework prevented for MODEL choice and the 2026-07-29
 * Phase 2 change prevents for CONTEXT depth. Each of these is a real driver with a real
 * problem who cannot name it in setup vocabulary. Under the old gates they got a cheap
 * model (fixed 07-28) on thin context (fixed 07-29) — the people who needed the
 * Engineer most got the weakest answers, silently.
 */
test("a driver who cannot name the problem gets the full path AND full context", () => {
  for (const msg of [
    "doesn't feel right",
    "I'm not happy with it",
    "where would you start?",
    "car is rubbish today",
    "what should I do next?",
    "I'm struggling out there today.",
    "It got worse as the day went on.",
    "car felt weird today, thoughts?",
  ]) {
    assert.equal(tier(msg), "full", `expected full tier for: ${msg}`);
    assert.equal(deep(msg), true, `expected deep context for: ${msg}`);
  }
});

test("only a recognised lap-history question with no run in focus takes the lookup path", () => {
  assert.equal(tier("what's my best lap at Kingston?"), "lookup");
  assert.equal(deep("what's my best lap at Kingston?"), false);
  // Same question with a run focused: they are looking AT a run, so advice is on the table.
  assert.equal(tier("what's my best lap at Kingston?", "run1"), "full");
  assert.equal(deep("what's my best lap at Kingston?", "run1"), true);
});

test("unrecognised input defaults to full + deep, never to a thin shape", () => {
  assert.equal(tier(undefined), "full");
  assert.equal(tier(""), "full");
  assert.equal(tier("asdfgh"), "full");
  assert.equal(deep("hello"), true);
});

test("run id forces full tier regardless of message", () => {
  assert.equal(deep("hi", "r1"), true);
  assert.equal(tier("hi", "", "r2"), "full");
});

test("setup and handling vocabulary is full tier (as everything is)", () => {
  assert.equal(deep("should I add front camber?"), true);
  assert.equal(
    deep("Car is pushing mid-corner on my last run. 10 minutes until the next one - what do I do?"),
    true
  );
  assert.equal(deep("the rear feels loose on exit"), true);
});

console.log("engineerChatContextTier.test.ts OK");
