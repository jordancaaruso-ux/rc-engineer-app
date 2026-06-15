/**
 * Run: `npx tsx src/lib/engineerPhase5/lapHistoryQuery.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { engineerChatIsLapHistoryQuestion, engineerChatNeedsDeepContext } from "@/lib/engineerPhase5/engineerChatContextTier";
import { parseLapHistoryDateWindow } from "@/lib/engineerPhase5/parseLapHistoryWindow";
import { parseLapHistoryQueryIntent } from "@/lib/engineerPhase5/lapHistoryQueryParse";

test("lap history question is light tier not deep", () => {
  const msg = "whats the best laptime ive done at tftr in the last 2 months";
  assert.equal(engineerChatIsLapHistoryQuestion(msg), true);
  assert.equal(
    engineerChatNeedsDeepContext({ lastUserMessage: msg, runId: "", compareRunId: "" }),
    false
  );
});

test("setup question stays deep tier", () => {
  const msg = "what spring change should I make for more rear grip";
  assert.equal(
    engineerChatNeedsDeepContext({ lastUserMessage: msg, runId: "", compareRunId: "" }),
    true
  );
});

test("parseLapHistoryQueryIntent extracts track", () => {
  const intent = parseLapHistoryQueryIntent(
    "whats the best laptime ive done at tftr in the last 2 months"
  );
  assert.ok(intent);
  assert.equal(intent!.trackQuery.toLowerCase(), "tftr");
});

test("parseLapHistoryDateWindow last 2 months", () => {
  const w = parseLapHistoryDateWindow("last 2 months", "UTC", new Date("2026-05-27T12:00:00Z"));
  assert.ok(w);
  assert.equal(w!.dateTo, "2026-05-27");
  assert.equal(w!.dateFrom, "2026-03-27");
});
