/**
 * Locks the blind-flip → winner mapping. A bug here would silently invert the founder's
 * pairwise picks and corrupt the headline trust number, so it gets its own test.
 * Run: npm run test:grader
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { founderWinner } from "./ingest-pairwise";

test("founderWinner undoes the blind flip", () => {
  // Not flipped: Answer ① shown first = engine A.
  assert.equal(founderWinner("1", false), "A");
  assert.equal(founderWinner("2", false), "B");
  // Flipped: Answer ① shown first = engine B.
  assert.equal(founderWinner("1", true), "B");
  assert.equal(founderWinner("2", true), "A");
  // Tie is order-independent.
  assert.equal(founderWinner("tie", false), "tie");
  assert.equal(founderWinner("tie", true), "tie");
});
