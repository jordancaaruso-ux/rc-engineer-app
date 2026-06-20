/**
 * Run: npx tsx src/lib/engineerFeedback/reviewerParse.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEngineerReviewerJson,
  reviewerPassesShipBar,
} from "@/lib/engineerFeedback/reviewerParse";

test("parseEngineerReviewerJson parses score and tags", () => {
  const raw = `Here is the review:
{"score":4,"tags":["good_grounding"],"rationale":"Solid KB cite."}`;
  const parsed = parseEngineerReviewerJson(raw);
  assert.ok(parsed);
  assert.equal(parsed?.score, 4);
  assert.deepEqual(parsed?.tags, ["good_grounding"]);
});

test("parseEngineerReviewerJson clamps score", () => {
  const parsed = parseEngineerReviewerJson('{"score":9,"tags":[],"rationale":"x"}');
  assert.equal(parsed?.score, 5);
});

test("reviewerPassesShipBar requires score >= 4 and no wrong_physics", () => {
  assert.equal(reviewerPassesShipBar({ score: 4, tags: [], rationale: "" }), true);
  assert.equal(reviewerPassesShipBar({ score: 3, tags: [], rationale: "" }), false);
  assert.equal(
    reviewerPassesShipBar({ score: 5, tags: ["wrong_physics"], rationale: "" }),
    false
  );
});
