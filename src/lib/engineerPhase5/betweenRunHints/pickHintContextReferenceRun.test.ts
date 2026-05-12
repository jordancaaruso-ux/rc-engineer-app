/**
 * Run: `npx tsx src/lib/engineerPhase5/betweenRunHints/pickHintContextReferenceRun.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarUtcDayKeyFromInstant,
  hintBaselineAgeBucket,
} from "@/lib/engineerPhase5/betweenRunHints/pickHintContextReferenceRun";

test("calendarUtcDayKeyFromInstant uses UTC date", () => {
  const d = new Date("2026-03-15T22:00:00.000Z");
  assert.equal(calendarUtcDayKeyFromInstant(d), "2026-03-15");
});

test("hintBaselineAgeBucket: same calendar day", () => {
  const a = new Date("2026-05-01T08:00:00.000Z").getTime();
  const b = new Date("2026-05-01T18:00:00.000Z").getTime();
  assert.equal(hintBaselineAgeBucket(a, b), "same_day");
});

test("hintBaselineAgeBucket: this_week across days", () => {
  const newer = new Date("2026-05-10T12:00:00.000Z").getTime();
  const older = new Date("2026-05-05T12:00:00.000Z").getTime();
  assert.equal(hintBaselineAgeBucket(newer, older), "this_week");
});

test("hintBaselineAgeBucket: older beyond 35 days", () => {
  const newer = new Date("2026-05-10T12:00:00.000Z").getTime();
  const older = new Date("2026-03-01T12:00:00.000Z").getTime();
  assert.equal(hintBaselineAgeBucket(newer, older), "older");
});
