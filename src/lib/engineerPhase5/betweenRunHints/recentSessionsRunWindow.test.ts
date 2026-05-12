/**
 * Run: `npx tsx src/lib/engineerPhase5/betweenRunHints/recentSessionsRunWindow.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { selectChronoRecentRunIds } from "@/lib/engineerPhase5/betweenRunHints/recentSessionsRunWindow";

const rows = [{ id: "n" }, { id: "m" }, { id: "o" }, { id: "p" }];

test("primary at newest returns primary plus next two older", () => {
  assert.deepEqual(selectChronoRecentRunIds(rows, "n", 3), ["n", "m", "o"]);
});

test("primary in middle returns primary and two older only", () => {
  assert.deepEqual(selectChronoRecentRunIds(rows, "m", 3), ["m", "o", "p"]);
});

test("missing primary in list falls back to singleton", () => {
  assert.deepEqual(selectChronoRecentRunIds(rows, "x", 3), ["x"]);
});

test("max 1 returns only primary when found", () => {
  assert.deepEqual(selectChronoRecentRunIds(rows, "o", 1), ["o"]);
});

test("max 0 returns empty", () => {
  assert.deepEqual(selectChronoRecentRunIds(rows, "n", 0), []);
});
