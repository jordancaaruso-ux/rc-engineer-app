/**
 * Run: npx tsx src/lib/engineerFeedback/goldSetCandidate.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashQuestion,
  mergeGoldSetCases,
  shouldCaptureGoldSetCandidate,
  slugifyGoldCaseId,
} from "@/lib/engineerFeedback/goldSetCandidateUtil";

test("shouldCaptureGoldSetCandidate is admin-only", () => {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  process.env.AUTH_ADMIN_EMAILS = "founder@example.com";
  try {
    assert.equal(shouldCaptureGoldSetCandidate("founder@example.com"), true);
    assert.equal(shouldCaptureGoldSetCandidate("tester@example.com"), false);
    assert.equal(shouldCaptureGoldSetCandidate(null), false);
  } finally {
    process.env.AUTH_ADMIN_EMAILS = prev;
  }
});

test("hashQuestion is stable and case-insensitive", () => {
  assert.equal(hashQuestion("What shims?"), hashQuestion("  what shims?  "));
  assert.equal(hashQuestion("A"), hashQuestion("a"));
});

test("slugifyGoldCaseId avoids collisions", () => {
  const taken = new Set(["push-mid-corner"]);
  assert.equal(slugifyGoldCaseId("Push mid corner!", taken), "push-mid-corner-2");
});

test("mergeGoldSetCases dedupes by id", () => {
  const merged = mergeGoldSetCases(
    [{ id: "a", question: "one" }],
    [
      { id: "a", question: "dup" },
      { id: "b", question: "two" },
    ]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.question, "one");
});
