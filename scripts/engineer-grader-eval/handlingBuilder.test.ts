/**
 * Round-trips every generated handling assessment through the REAL parser.
 *
 * This is the test that matters most in the factory: a blob that looks fine but loses its
 * primaryFocus or speedTags on parse would silently starve the Engineer of symptom signal,
 * and we'd wrongly annotate the resulting vague answer as a delivery flaw.
 * Run: npm run test:grader
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatHandlingAssessmentForEngineer,
  isHandlingAssessmentMeaningful,
  parseHandlingAssessmentJson,
} from "@/lib/runHandlingAssessment";
import { buildHandlingForProblem, withFeelVsLastRun, withSpeedTag } from "./handlingBuilder";
import type { ProblemTypeId } from "./types";

const ALL_PROBLEMS: ProblemTypeId[] = [
  "entry-understeer",
  "mid-understeer",
  "exit-oversteer",
  "on-power-snap",
  "traction-roll",
  "braking-loose",
  "darty",
  "inconsistent",
  "tires-going-off",
  "nothing-wrong",
];

test("every problem type parses and stays meaningful", () => {
  for (const p of ALL_PROBLEMS) {
    const { assessment } = buildHandlingForProblem(p);
    const parsed = parseHandlingAssessmentJson(assessment);
    assert.ok(parsed, `${p}: failed to parse`);
    assert.ok(isHandlingAssessmentMeaningful(assessment), `${p}: parsed to nothing meaningful`);
    assert.ok(
      formatHandlingAssessmentForEngineer(assessment).includes("— Handling —"),
      `${p}: produced no Engineer-visible handling block`
    );
  }
});

test("primaryFocus survives the parser (it is dropped when it doesn't match a set value)", () => {
  for (const p of ALL_PROBLEMS) {
    const { assessment } = buildHandlingForProblem(p);
    if (!assessment.primaryFocus) continue; // "nothing-wrong" sets none by design
    const parsed = parseHandlingAssessmentJson(assessment);
    assert.deepEqual(
      parsed?.primaryFocus,
      assessment.primaryFocus,
      `${p}: primaryFocus was dropped on parse — it must exactly match the field it points at`
    );
  }
});

test("speed tags survive the parser (they are pruned when the issue isn't flagged)", () => {
  for (const p of ALL_PROBLEMS) {
    const spec = withSpeedTag(buildHandlingForProblem(p), "slow");
    const tagged = spec.assessment.speedTags;
    if (!tagged) continue; // "nothing-wrong" flags no issue, so no tag can attach
    const parsed = parseHandlingAssessmentJson(spec.assessment);
    assert.deepEqual(parsed?.speedTags, tagged, `${p}: speed tags were pruned on parse`);
  }
});

test("severity scales the flagged pole in the right direction", () => {
  // Problem poles: onPower/braking/driveEase negative, tractionRoll positive.
  const snap = buildHandlingForProblem("on-power-snap", 3).assessment;
  assert.equal(snap.onPower, -3);
  const roll = buildHandlingForProblem("traction-roll", 3).assessment;
  assert.equal(roll.tractionRoll, 3);
  const push = buildHandlingForProblem("entry-understeer", 1).assessment;
  assert.equal(push.balanceByPhase?.entry, -1);
});

test("feelVsLastRun round-trips", () => {
  const spec = withFeelVsLastRun(buildHandlingForProblem("mid-understeer"), -2);
  const parsed = parseHandlingAssessmentJson(spec.assessment);
  assert.equal(parsed?.feelVsLastRun, -2);
});
