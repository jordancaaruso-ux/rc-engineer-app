import { strict as assert } from "node:assert";
import { test } from "node:test";

import { setupHoldsValues } from "./setupHoldsValues";

/*
 * The SQL arm of `userHasAnySetup` asks this same question of Postgres. It cannot be exercised
 * without a database, so the cases below double as the specification it has to match:
 *
 *   AND jsonb_typeof(s."data") = 'object'
 *   AND EXISTS (SELECT 1 FROM jsonb_each(s."data") kv
 *               WHERE kv.value <> 'null'::jsonb AND kv.value <> '""'::jsonb)
 *
 * If one changes, change both.
 */

test("an empty shell is not a setup", () => {
  assert.equal(setupHoldsValues({}), false);
  assert.equal(setupHoldsValues({ frontRideHeight: null, rearRideHeight: null }), false);
  assert.equal(setupHoldsValues({ frontSpring: "", rearSpring: "" }), false);
  assert.equal(setupHoldsValues({ a: null, b: "", c: undefined }), false);
});

test("one real number is enough", () => {
  assert.equal(setupHoldsValues({ frontRideHeight: 5.5, rearRideHeight: null }), true);
  assert.equal(setupHoldsValues({ note: "soft" }), true);
});

test("zero and false are values, not blanks", () => {
  // A field legitimately set to 0 (droop, toe) must not read as untouched — this is the case a
  // truthiness check would get wrong.
  assert.equal(setupHoldsValues({ frontToe: 0 }), true);
  assert.equal(setupHoldsValues({ sway: false }), true);
});

test("non-objects hold nothing", () => {
  assert.equal(setupHoldsValues(null), false);
  assert.equal(setupHoldsValues(undefined), false);
  assert.equal(setupHoldsValues("frontRideHeight"), false);
  assert.equal(setupHoldsValues(42), false);
  // jsonb_typeof(...) = 'object' rejects arrays too, so this must agree.
  assert.equal(setupHoldsValues([1, 2, 3]), false);
});

test("a full sheet holds values", () => {
  const full = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`field${i}`, i]));
  assert.equal(setupHoldsValues(full), true);
});
