/**
 * Run: `npx tsx src/lib/runHandlingAssessmentQuickPick.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coerceFeelVsLastRunForCompleteRun,
  formatFeelVsLastRunQuickLabel,
} from "@/lib/runHandlingAssessment";

test("formatFeelVsLastRunQuickLabel maps quick-pick values including Similar", () => {
  assert.equal(formatFeelVsLastRunQuickLabel(-3), "Much worse");
  assert.equal(formatFeelVsLastRunQuickLabel(-2), "Worse");
  assert.equal(formatFeelVsLastRunQuickLabel(0), "Similar");
  assert.equal(formatFeelVsLastRunQuickLabel(2), "Better");
  assert.equal(formatFeelVsLastRunQuickLabel(3), "Much better");
});

test("coerceFeelVsLastRunForCompleteRun requires selection when prior run exists", () => {
  const result = coerceFeelVsLastRunForCompleteRun(null, true);
  assert.equal(result.error, "Pick how this run felt vs your last run on this car before marking complete.");
  assert.equal(result.parsed, null);
});

test("coerceFeelVsLastRunForCompleteRun defaults to Similar on first run", () => {
  const result = coerceFeelVsLastRunForCompleteRun(null, false);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.parsed, { version: 5, feelVsLastRun: 0 });
});

test("coerceFeelVsLastRunForCompleteRun preserves other handling fields when coercing", () => {
  const raw = { version: 5, balanceByPhase: { entry: -1 } };
  const result = coerceFeelVsLastRunForCompleteRun(raw, false);
  assert.equal(result.parsed?.feelVsLastRun, 0);
  assert.deepEqual(result.parsed?.balanceByPhase, { entry: -1 });
});
