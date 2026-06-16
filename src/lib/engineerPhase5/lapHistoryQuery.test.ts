/**
 * Run: `npx tsx src/lib/engineerPhase5/lapHistoryQuery.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { engineerChatIsLapHistoryQuestion, engineerChatNeedsDeepContext } from "@/lib/engineerPhase5/engineerChatContextTier";
import { parseLapHistoryDateWindow } from "@/lib/engineerPhase5/parseLapHistoryWindow";
import {
  extractLapHistoryPriorFromMessages,
  extractLapRank,
  extractLapTimeProbe,
  extractTireLabelContains,
  parseLapHistoryQueryIntent,
  stripTireQualifierClause,
} from "@/lib/engineerPhase5/lapHistoryQueryParse";

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
  assert.equal(intent!.tireLabelContains, null);
});

test("parseLapHistoryQueryIntent splits track and tire qualifier", () => {
  const intent = parseLapHistoryQueryIntent(
    "what is the fastest lap ive done at tftr on vaulk tires"
  );
  assert.ok(intent);
  assert.equal(intent!.trackQuery.toLowerCase(), "tftr");
  assert.equal(intent!.tireLabelContains?.toLowerCase(), "vaulk");
});

test("tire qualifier works before track when clause is stripped", () => {
  const msg = "fastest lap on vault tires at tftr";
  assert.equal(extractTireLabelContains(msg)?.toLowerCase(), "vault");
  assert.equal(stripTireQualifierClause(msg).toLowerCase(), "fastest lap at tftr");
  const intent = parseLapHistoryQueryIntent(msg);
  assert.ok(intent);
  assert.equal(intent!.trackQuery.toLowerCase(), "tftr");
  assert.equal(intent!.tireLabelContains?.toLowerCase(), "vault");
});

test("parseLapHistoryDateWindow last 2 months", () => {
  const w = parseLapHistoryDateWindow("last 2 months", "UTC", new Date("2026-05-27T12:00:00Z"));
  assert.ok(w);
  assert.equal(w!.dateTo, "2026-05-27");
  assert.equal(w!.dateFrom, "2026-03-27");
});

test("follow-up next best uses prior TFTR context", () => {
  const prior = extractLapHistoryPriorFromMessages([
    { role: "user", content: "whats my best laptime at tftr" },
    {
      role: "assistant",
      content:
        "At **TFTR** (your log, 69 runs, excluded laps omitted):\n- **Best lap:** 8.182s — …",
    },
  ]);
  assert.ok(prior);
  assert.equal(prior!.trackQuery, "TFTR");
  const intent = parseLapHistoryQueryIntent("whats my next best", prior);
  assert.ok(intent);
  assert.equal(intent!.trackQuery, "TFTR");
  assert.equal(intent!.lapRank, 2);
  assert.equal(intent!.wantsAvgTop5, false);
});

test("correction with lap time probes prior track", () => {
  const prior = extractLapHistoryPriorFromMessages([
    { role: "user", content: "whats my best laptime at tftr" },
    { role: "assistant", content: "At **TFTR** (your log, 69 runs…)" },
    { role: "user", content: "whats my next best" },
    { role: "assistant", content: "At **TFTR** … **Next best lap:** 15.732s …" },
  ]);
  assert.ok(prior);
  const intent = parseLapHistoryQueryIntent("no, i have done a 15.5", prior);
  assert.ok(intent);
  assert.equal(intent!.lapTimeProbe, 15.5);
  assert.equal(intent!.trackQuery, "TFTR");
});

test("extractLapRank maps next best to 2", () => {
  assert.equal(extractLapRank("whats my next best"), 2);
  assert.equal(extractLapTimeProbe("no, i have done a 15.5"), 15.5);
});
