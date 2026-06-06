/**
 * Run: `npx tsx src/lib/setupSheetModels/awesomatixFieldKeyCollision.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { awesomatixFieldKeyCollisionWarning } from "@/lib/setupSheetModels/awesomatixFieldKeyCollision";

test("warns when numeric field uses Awesomatix spring key", () => {
  const msg = awesomatixFieldKeyCollisionWarning("spring_front", "number");
  assert.ok(msg?.includes("spring_front"));
  assert.ok(msg?.includes("spring_rate_front"));
});

test("allows one_of_many when key matches Awesomatix single-select", () => {
  assert.equal(awesomatixFieldKeyCollisionWarning("spring_front", "one_of_many"), null);
});

test("ignores non-catalog keys", () => {
  assert.equal(awesomatixFieldKeyCollisionWarning("spring_rate_front", "number"), null);
});
