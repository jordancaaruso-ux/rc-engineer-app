/**
 * Run: `npx tsx src/lib/runHandlingAssessmentQuickPick.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatFeelVsLastRunQuickLabel,
  formatHandlingAssessmentDetailLines,
  parseHandlingAssessmentJson,
} from "@/lib/runHandlingAssessment";

test("formatFeelVsLastRunQuickLabel maps quick-pick values including Similar", () => {
  assert.equal(formatFeelVsLastRunQuickLabel(-3), "Much worse");
  assert.equal(formatFeelVsLastRunQuickLabel(-2), "Worse");
  assert.equal(formatFeelVsLastRunQuickLabel(0), "Similar");
  assert.equal(formatFeelVsLastRunQuickLabel(2), "Better");
  assert.equal(formatFeelVsLastRunQuickLabel(3), "Much better");
});

/*
 * Completion used to seed `feelVsLastRun: 0` on a car's first outing, left over from when
 * the pick was required and had nothing to compare against. 0 means "Similar", so the
 * Engineer was told a car felt unchanged versus a run that never happened. These pin the
 * replacement rule: an unanswered field stays unanswered, and only a real answer is read
 * back. See the note where `coerceFeelVsLastRunForCompleteRun` used to live.
 */
test("an unanswered feel-vs-last-run stays absent rather than becoming Similar", () => {
  assert.equal(parseHandlingAssessmentJson(null), null);

  const parsed = parseHandlingAssessmentJson({ version: 6, balanceByPhase: { entry: -1 } });
  assert.equal(parsed?.feelVsLastRun ?? null, null);
  // The rest of the answers still survive the round trip.
  assert.deepEqual(parsed?.balanceByPhase, { entry: -1 });
});

test("only a real feel-vs-last-run answer reaches the read-back lines", () => {
  const unanswered = formatHandlingAssessmentDetailLines({
    version: 6,
    balanceByPhase: { entry: -1 },
  });
  assert.equal(
    unanswered.some((line) => line.startsWith("Feel vs last run:")),
    false
  );

  const answered = formatHandlingAssessmentDetailLines({ version: 6, feelVsLastRun: -2 });
  assert.equal(
    answered.some((line) => line.startsWith("Feel vs last run:")),
    true
  );
});
