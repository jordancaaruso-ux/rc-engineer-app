/**
 * Run: `npm run test:timing-identity`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasTimingIdentity } from "@/lib/onboarding/timingIdentity";

test("club/loaner chip satisfies the transponder half of the identity", () => {
  assert.equal(
    hasTimingIdentity({ timingName: "Jordan", transponderCount: 0, transponderLoaner: true }),
    true
  );
  assert.equal(
    hasTimingIdentity({ timingName: null, transponderCount: 3, transponderLoaner: false }),
    false,
    "transponders without a timing name still can't match laps"
  );
});

test("needs a printed name AND (a number OR the loaner chip)", () => {
  assert.equal(
    hasTimingIdentity({ timingName: "Jordan", transponderCount: 1, transponderLoaner: false }),
    true
  );
  assert.equal(
    hasTimingIdentity({ timingName: "Jordan", transponderCount: 0, transponderLoaner: false }),
    false,
    "a name alone can't match laps"
  );
});

test("whitespace-only timing name does not count", () => {
  assert.equal(
    hasTimingIdentity({ timingName: "   ", transponderCount: 1, transponderLoaner: false }),
    false
  );
});
