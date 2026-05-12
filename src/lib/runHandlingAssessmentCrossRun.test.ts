/**
 * Run: `npx tsx src/lib/runHandlingAssessmentCrossRun.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHandlingAssessmentCrossRunBlock } from "@/lib/runHandlingAssessmentCrossRun";

function v5(partial: Record<string, unknown>) {
  return { version: 5, ...partial };
}

test("entry balance −3 → −1 shows less push wording and correct trend phrase", () => {
  const compare = v5({ balanceByPhase: { entry: -3, mid: 0, exit: 0 } });
  const primary = v5({ balanceByPhase: { entry: -1, mid: 0, exit: 0 } });
  const block = buildHandlingAssessmentCrossRunBlock(compare, primary);
  assert.ok(block);
  assert.match(block, /toward push.*severe.*\(-3\)/);
  assert.match(block, /toward push.*mild.*\(-1\)/);
  assert.match(block, /shifted toward oversteer vs compare by 2 step/);
});

test("unchanged trait axis emits no line for that axis", () => {
  const compare = v5({ feelSteering: 1, feelGeneral: -1 });
  const primary = v5({ feelSteering: 1, feelGeneral: 0 });
  const block = buildHandlingAssessmentCrossRunBlock(compare, primary);
  assert.ok(block);
  assert.doesNotMatch(block, /Steering feel/);
  assert.match(block, /General feel/);
});

test("both JSON unparseable → null", () => {
  assert.equal(buildHandlingAssessmentCrossRunBlock({ version: 99 }, { foo: 1 }), null);
});

test("feelVsLastRun on either side adds footnote without inventing a cross-run delta on that field", () => {
  const compare = v5({ balanceByPhase: { entry: 0, mid: 0, exit: 0 }, feelVsLastRun: -1 });
  const primary = v5({ balanceByPhase: { entry: 0, mid: 0, exit: 0 }, feelVsLastRun: 2 });
  const block = buildHandlingAssessmentCrossRunBlock(compare, primary);
  assert.ok(block);
  assert.match(block, /Feel vs last run/);
  assert.doesNotMatch(block, /feelVsLastRun/);
  assert.doesNotMatch(block, /−1 → \+2/);
});

test("identical comparable fields and no feelVsLastRun → null", () => {
  const j = v5({
    balanceByPhase: { entry: 1, mid: 1, exit: 1 },
    feelSteering: 0,
    feelGeneral: 0,
    driveEase: 0,
    tractionRoll: 0,
  });
  assert.equal(buildHandlingAssessmentCrossRunBlock(j, j), null);
});

test("identical fields but feelVsLastRun present → header + footnote only", () => {
  const j = v5({
    balanceByPhase: { entry: 1, mid: 1, exit: 1 },
    feelVsLastRun: 1,
  });
  const block = buildHandlingAssessmentCrossRunBlock(j, j);
  assert.ok(block);
  assert.match(block, /deterministic/);
  assert.match(block, /Note:/);
  assert.doesNotMatch(block, /Corner entry/);
});
