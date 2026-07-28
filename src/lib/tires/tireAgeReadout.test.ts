/**
 * Run: `npx tsx src/lib/tires/tireAgeReadout.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveTireChoice,
  isDifferentTires,
  tireAgeReadout,
  tireCountLabel,
} from "@/lib/tires/tireAgeReadout";
import type { TireStintValue } from "@/lib/tires/tireStintValue";

const v = (runsCompleted: number, ageKnown = true, stintId: string | null = null): TireStintValue => ({
  runsCompleted,
  ageKnown,
  stintId,
});

test("a fresh set never renders a number — the whole point of the rework", () => {
  const r = tireAgeReadout("new", v(0));
  assert.equal(r.title, "New tires");
  assert.match(r.sub, /^no runs on them yet/);
  assert.equal(/\b1\b/.test(r.title), false);
  // Same value reached down the "same tires" path reads identically.
  assert.deepEqual(tireAgeReadout("same", v(0, true, "stint-1")), r);
});

test("a carried set counts runs done and promises the run number", () => {
  const r = tireAgeReadout("same", v(2, true, "stint-1"));
  assert.equal(r.title, "2 runs on these");
  assert.equal(r.sub, "this will be run 3");
  assert.equal(r.unresolved, false);
  assert.equal(tireAgeReadout("used", v(1)).title, "1 run on these");
});

test("nothing answered yet asks instead of inventing run 1", () => {
  const r = tireAgeReadout(null, v(0));
  assert.equal(r.title, "Not set yet");
  assert.equal(r.unresolved, true);
});

test("different-but-unanswered is its own state, not a guess", () => {
  const r = tireAgeReadout("different", v(0, false));
  assert.equal(r.title, "Which set went on?");
  assert.equal(r.unresolved, true);
  // ageKnown:false underneath must not leak "Age unknown" into the question.
  assert.equal(r.sub, "Pick brand new or used above");
});

test("unknown age claims no count", () => {
  assert.equal(tireAgeReadout("used", v(0, false)).title, "Age unknown");
  assert.equal(tireAgeReadout("used", v(0, false)).sub, "first run since you got them");
  assert.equal(tireAgeReadout("used", v(3, false)).sub, "3 runs since you got them");
});

test("choice derived from an incoming value", () => {
  assert.equal(deriveTireChoice(v(0)), null, "bare zero is unanswered, not brand new");
  assert.equal(deriveTireChoice(v(0, true, "stint-1")), "same", "a live stint is carried on");
  assert.equal(deriveTireChoice(v(4)), "same", "a count with no stint is still an answer");
  assert.equal(deriveTireChoice(v(0, false)), "used", "'not sure' is an answered used set");
});

test("both branches of the follow-up count as different tires", () => {
  assert.equal(isDifferentTires("different"), true);
  assert.equal(isDifferentTires("new"), true);
  assert.equal(isDifferentTires("used"), true);
  assert.equal(isDifferentTires("same"), false);
  assert.equal(isDifferentTires(null), false);
});

test("stepper label uses words so no numeral reads as an index", () => {
  assert.equal(tireCountLabel(0), "New");
  assert.equal(tireCountLabel(1), "1 run");
  assert.equal(tireCountLabel(7), "7 runs");
});
