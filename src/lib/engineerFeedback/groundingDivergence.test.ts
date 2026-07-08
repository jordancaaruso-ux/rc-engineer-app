/**
 * Run: npx tsx src/lib/engineerFeedback/groundingDivergence.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groundingReport,
  groundingVerdict,
  groundingVerdictIsFailure,
  SENSITIVE_MIN_DIVERGENCE,
  INVARIANT_MAX_DIVERGENCE,
} from "@/lib/engineerFeedback/groundingDivergence";

test("identical answers → zero divergence (the generic signature)", () => {
  const same = "Soften the front anti-roll bar to calm mid-corner push and add front grip.";
  const r = groundingReport([same, same, same]);
  assert.equal(r.meanSimilarity, 1);
  assert.equal(r.divergence, 0);
  assert.equal(r.nearDuplicatePairs.length, 3); // all 3 pairs
});

test("substantively different answers → high divergence (grounded signature)", () => {
  const r = groundingReport([
    "Your loose exit points at rear roll centre; raise rear inner camber links a shim.",
    "Given the cold track and low grip, thicker front damper oil steadies the platform on entry.",
    "Mid-corner understeer with this spring split — soften the front spring one step first.",
  ]);
  assert.ok(r.divergence > 0.6, `expected high divergence, got ${r.divergence}`);
  assert.equal(r.nearDuplicatePairs.length, 0);
});

test("verdict: sensitive probe that didn't move is generic", () => {
  assert.equal(groundingVerdict("sensitive", SENSITIVE_MIN_DIVERGENCE - 0.1), "generic");
  assert.equal(groundingVerdict("sensitive", SENSITIVE_MIN_DIVERGENCE + 0.1), "grounded");
});

test("verdict: invariant probe SHOULD be stable — moving is inconsistent, stable is fine", () => {
  // This is the class the LLM classifier over-tagged: a teaching answer that stays the
  // same across contexts is CORRECT here, not generic.
  assert.equal(groundingVerdict("invariant", INVARIANT_MAX_DIVERGENCE - 0.1), "consistent");
  assert.equal(groundingVerdict("invariant", INVARIANT_MAX_DIVERGENCE + 0.1), "inconsistent");
});

test("failure classification", () => {
  assert.ok(groundingVerdictIsFailure("generic"));
  assert.ok(groundingVerdictIsFailure("inconsistent"));
  assert.ok(!groundingVerdictIsFailure("grounded"));
  assert.ok(!groundingVerdictIsFailure("consistent"));
});

test("boilerplate/stopwords don't mask real divergence", () => {
  // Two answers sharing only scaffolding ("I'd try ... expected effect ...") should still
  // read as divergent because the substantive tokens differ.
  const a = "I'd try softening the front spring; expected effect is more mid-corner front grip.";
  const b = "I'd try raising the rear roll centre; expected effect is more on-power rear drive.";
  const r = groundingReport([a, b]);
  assert.ok(r.divergence > 0.5, `stopword strip should surface divergence, got ${r.divergence}`);
});

test("single answer degenerates gracefully", () => {
  const r = groundingReport(["only one answer"]);
  assert.equal(r.n, 1);
  assert.equal(r.divergence, 0); // no pairs → treated as fully similar
});
