/**
 * Run: npx tsx src/lib/engineerFeedback/failureTaxonomy.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addToDistribution,
  emptyDistribution,
  judgeTagsToFailureClasses,
  judgeTagsToSecondarySignals,
  knowledgeLayerFailureCount,
  primaryFailureFromClasses,
  MISDIAGNOSIS_MEASURABLE_FROM_TAGS,
} from "@/lib/engineerFeedback/failureTaxonomy";

test("maps calibration tags to miscalibration", () => {
  assert.deepEqual(judgeTagsToFailureClasses(["false_confidence"]), ["miscalibration"]);
  assert.deepEqual(judgeTagsToFailureClasses(["over_hedged"]), ["miscalibration"]);
});

test("maps context/generic tags to genericness", () => {
  assert.deepEqual(judgeTagsToFailureClasses(["generic_advice"]), ["genericness"]);
  assert.deepEqual(judgeTagsToFailureClasses(["ignored_context"]), ["genericness"]);
});

test("maps laundry_list tag to laundry_list class", () => {
  assert.deepEqual(judgeTagsToFailureClasses(["laundry_list"]), ["laundry_list"]);
});

test("positive and secondary tags are not failure classes", () => {
  assert.deepEqual(
    judgeTagsToFailureClasses(["good_diagnosis", "good_confidence", "no_prediction", "wrong_physics"]),
    []
  );
});

test("INVARIANT: tag-mapping is blind to misdiagnosis (the whole point)", () => {
  // No combination of real judge tags can produce misdiagnosis from the free pass.
  const everyTag = judgeTagsToFailureClasses([
    "false_confidence",
    "generic_advice",
    "laundry_list",
    "over_hedged",
    "no_prediction",
    "ignored_context",
    "wrong_physics",
    "missing_kb_citation",
    "good_confidence",
    "good_grounding",
    "good_diagnosis",
  ]);
  assert.ok(!everyTag.includes("misdiagnosis"));
  assert.equal(MISDIAGNOSIS_MEASURABLE_FROM_TAGS, false);
});

test("multi-label: dedupes classes, keeps worst-first order", () => {
  // ignored_context + generic_advice both → genericness (dedupe); false_confidence → miscalibration.
  assert.deepEqual(
    judgeTagsToFailureClasses(["laundry_list", "generic_advice", "ignored_context", "false_confidence"]),
    ["miscalibration", "genericness", "laundry_list"]
  );
});

test("secondary signal extraction", () => {
  assert.deepEqual(
    judgeTagsToSecondarySignals(["no_prediction", "missing_kb_citation", "generic_advice"]),
    ["no_prediction", "missing_kb_citation"]
  );
});

test("primaryFailure picks the worst present", () => {
  assert.equal(primaryFailureFromClasses(["laundry_list", "miscalibration"]), "miscalibration");
  assert.equal(primaryFailureFromClasses(["genericness", "laundry_list"]), "genericness");
  assert.equal(primaryFailureFromClasses([]), null);
});

test("distribution aggregates multi-label + primary + secondary consistently", () => {
  const dist = emptyDistribution();
  addToDistribution(dist, ["genericness", "laundry_list"], ["no_prediction"]);
  addToDistribution(dist, ["miscalibration"], []);
  addToDistribution(dist, [], []); // clean

  assert.equal(dist.total, 3);
  assert.equal(dist.cleanCount, 1);
  assert.equal(dist.byClass.genericness, 1);
  assert.equal(dist.byClass.laundry_list, 1);
  assert.equal(dist.byClass.miscalibration, 1);
  // Primary is single-label; sums with cleanCount to total.
  const primarySum = Object.values(dist.byPrimary).reduce((s, n) => s + n, 0);
  assert.equal(primarySum + dist.cleanCount, dist.total);
  // First answer's primary is genericness (worse than laundry_list).
  assert.equal(dist.byPrimary.genericness, 1);
  assert.equal(dist.byPrimary.miscalibration, 1);
  assert.equal(dist.bySecondary.no_prediction, 1);
});

test("knowledgeLayerFailureCount sums misdiagnosis + wrong_physics and flags measurability", () => {
  const dist = emptyDistribution();
  addToDistribution(dist, ["genericness"], ["wrong_physics"]);
  const k = knowledgeLayerFailureCount(dist);
  assert.equal(k.count, 1); // wrong_physics only; no misdiagnosis measured
  assert.equal(k.misdiagnosisMeasured, false);
});
