/**
 * Run: `npx tsx src/lib/tires/tireMark.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTireMark, formatMark, suggestTireMark, TIRE_MARK_MAX } from "@/lib/tires/tireMark";

test("normalizeTireMark trims, collapses whitespace, caps length, empties → null", () => {
  assert.equal(normalizeTireMark("  7 "), "7");
  assert.equal(normalizeTireMark("A 2"), "A 2");
  assert.equal(normalizeTireMark("A   2"), "A 2");
  assert.equal(normalizeTireMark("REDXX"), "REDX"); // capped at TIRE_MARK_MAX
  assert.equal(normalizeTireMark(""), null);
  assert.equal(normalizeTireMark("   "), null);
  assert.equal(normalizeTireMark(null), null);
  assert.equal(normalizeTireMark(undefined), null);
  assert.equal(TIRE_MARK_MAX, 4);
});

test("formatMark prefixes 'Marked' or returns null", () => {
  assert.equal(formatMark("7"), "Marked 7");
  assert.equal(formatMark("  A2 "), "Marked A2");
  assert.equal(formatMark(""), null);
  assert.equal(formatMark(null), null);
});

test("suggestTireMark returns the lowest free number, filling gaps and recycling", () => {
  assert.equal(suggestTireMark([]), "1"); // nothing marked yet
  assert.equal(suggestTireMark(["1", "2", "3"]), "4"); // next after a full run
  assert.equal(suggestTireMark(["1", "3"]), "2"); // fills the gap
  assert.equal(suggestTireMark(["2", "3"]), "1"); // 1 freed up (recycle) → reuse it
  assert.equal(suggestTireMark(["1", null, "3", undefined]), "2"); // ignores blanks
  assert.equal(suggestTireMark([" 1 ", "2"]), "3"); // normalizes before comparing
  assert.equal(suggestTireMark(["A2", "RED", "1"]), "2"); // non-numeric marks are skipped
  assert.equal(suggestTireMark(["A2", "RED"]), "1"); // only non-numeric → start at 1
});
