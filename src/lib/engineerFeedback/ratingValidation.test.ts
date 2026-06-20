/**
 * Run: npx tsx src/lib/engineerFeedback/ratingValidation.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeContextSnapshots,
  normalizeRatingNote,
  normalizeRatingStars,
  parseRatingInput,
} from "@/lib/engineerFeedback/ratingValidation";

test("normalizeRatingStars accepts 0-10 only", () => {
  assert.equal(normalizeRatingStars(0), 0);
  assert.equal(normalizeRatingStars(10), 10);
  assert.equal(normalizeRatingStars(3), 3);
  assert.equal(normalizeRatingStars("4"), 4);
  assert.equal(normalizeRatingStars(-1), null);
  assert.equal(normalizeRatingStars(11), null);
  assert.equal(normalizeRatingStars(3.5), null);
});

test("normalizeRatingNote trims and caps length", () => {
  assert.equal(normalizeRatingNote("  hello  "), "hello");
  assert.equal(normalizeRatingNote(""), null);
  assert.equal(normalizeRatingNote(null), null);
});

test("parseRatingInput rejects invalid score", () => {
  const bad = parseRatingInput({ score: 11 });
  assert.equal(bad.ok, false);
});

test("parseRatingInput accepts score alias", () => {
  const good = parseRatingInput({ score: 8, note: "Great" });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.stars, 8);
    assert.equal(good.value.note, "Great");
  }
});

test("parseRatingInput accepts legacy stars field", () => {
  const good = parseRatingInput({ stars: 5, note: "OK" });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.stars, 5);
  }
});

test("mergeContextSnapshots adds capturedAtIso", () => {
  const merged = mergeContextSnapshots({ question: "Q" }, { answer: "A" });
  assert.equal(merged.question, "Q");
  assert.equal(merged.answer, "A");
  assert.ok(typeof merged.capturedAtIso === "string");
});
