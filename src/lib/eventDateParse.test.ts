/**
 * Run: `npx tsx src/lib/eventDateParse.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEventDateYmd } from "@/lib/eventDateParse";

test("parseEventDateYmd stores YYYY-MM-DD at UTC noon", () => {
  const d = parseEventDateYmd("2026-05-26");
  assert.equal(d.toISOString(), "2026-05-26T12:00:00.000Z");
});

test("parseEventDateYmd passes through Date instances", () => {
  const input = new Date(Date.UTC(2026, 4, 26, 8, 30, 0, 0));
  assert.equal(parseEventDateYmd(input).getTime(), input.getTime());
});
