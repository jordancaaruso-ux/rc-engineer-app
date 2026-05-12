/**
 * Run: `npx tsx src/lib/engineerPhase5/betweenRunHints/betweenRunHintFramingIntentLines.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { buildBetweenRunHintFramingIntentLines } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintFramingIntentLines";

test("always includes balance-chip framing", () => {
  const lines = buildBetweenRunHintFramingIntentLines([]);
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /toward 0/);
  assert.match(lines[0]!, /most balanced/);
  assert.match(lines[1]!, /run-local/);
  assert.match(lines[2]!, /pairwise \(hint baseline\)/i);
});

test("adds pairwise already-applied framing when setup changes exist", () => {
  const row: EngineerRunSummaryV2["setupChanges"][number] = {
    key: "toe_rear",
    label: "Toe · Rear",
    before: "3",
    after: "2.5",
    rankReason: "",
    severity: "medium",
  };
  const lines = buildBetweenRunHintFramingIntentLines([row]);
  assert.equal(lines.length, 4);
  assert.match(lines[3]!, /already applied/);
  assert.match(lines[3]!, /after/);
});
