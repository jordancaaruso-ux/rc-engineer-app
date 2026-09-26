/**
 * Run: `npx tsx --test src/lib/trackMetaTags.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGripTags, pickOneTag } from "@/lib/trackMetaTags";

test("tapping a grip value replaces the one that was lit", () => {
  assert.deepEqual(pickOneTag(["VERY_LOW"], "HIGH"), ["HIGH"]);
  assert.deepEqual(pickOneTag([], "MEDIUM"), ["MEDIUM"]);
});

test("tapping the only lit value clears it", () => {
  assert.deepEqual(pickOneTag(["HIGH"], "HIGH"), []);
});

test("a track saved with two values keeps just the tapped one (test drive 13-3)", () => {
  // "Very low · High" from before the rule: tapping either leaves that one alone.
  assert.deepEqual(pickOneTag(["VERY_LOW", "HIGH"], "HIGH"), ["HIGH"]);
  assert.deepEqual(pickOneTag(["VERY_LOW", "HIGH"], "VERY_LOW"), ["VERY_LOW"]);
  assert.deepEqual(pickOneTag(["VERY_LOW", "HIGH"], "MEDIUM"), ["MEDIUM"]);
});

test("the one value saves cleanly through the server's normalizer", () => {
  assert.deepEqual(normalizeGripTags(pickOneTag(["VERY_LOW"], "HIGH")), ["HIGH"]);
  assert.deepEqual(normalizeGripTags(pickOneTag(["HIGH"], "HIGH")), []);
});
