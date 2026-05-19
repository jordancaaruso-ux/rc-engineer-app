/**
 * Run: `npx tsx src/lib/engineerPhase5/inferFeelFromRatings.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { inferFeelVsReferenceFromRatings } from "@/lib/engineerPhase5/inferFeelFromRatings";

test("infers mild better from 6 to 7", () => {
  const r = inferFeelVsReferenceFromRatings(7, 6);
  assert.equal(r?.direction, "better");
  assert.equal(r?.value, 1);
  assert.equal(r?.magnitudeWord, "mild");
});

test("returns null when either rating missing", () => {
  assert.equal(inferFeelVsReferenceFromRatings(null, 6), null);
  assert.equal(inferFeelVsReferenceFromRatings(7, null), null);
});
