/**
 * Run: `npx tsx src/lib/engineerPhase5/parameterEffects/intentFromMessage.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectOutcomeIntent } from "@/lib/engineerPhase5/parameterEffects/intentFromMessage";

test("front_rotation increase phrases route to front_rotation", () => {
  for (const msg of ["I want more front rotation", "the front won't rotate", "nose wont tuck into the apex"]) {
    const d = detectOutcomeIntent(msg);
    assert.ok(d, `no intent for: ${msg}`);
    assert.equal(d!.outcome, "front_rotation");
    assert.equal(d!.direction, "increase");
  }
});

test("front_rotation decrease phrases route to front_rotation (not front_grip)", () => {
  for (const msg of ["too much front rotation", "the front rotates too much", "car is too pointy"]) {
    const d = detectOutcomeIntent(msg);
    assert.ok(d, `no intent for: ${msg}`);
    assert.equal(d!.outcome, "front_rotation", `wrong outcome for: ${msg}`);
    assert.equal(d!.direction, "decrease");
  }
});

test("generic front grip / understeer still routes to front_grip", () => {
  const a = detectOutcomeIntent("the car pushes mid corner, need more front grip");
  assert.equal(a!.outcome, "front_grip");
  const b = detectOutcomeIntent("too much front");
  assert.equal(b!.outcome, "front_grip");
  assert.equal(b!.direction, "decrease");
});

test("generic rotation still routes to rear_rotation", () => {
  const d = detectOutcomeIntent("car won't rotate, need more rotation");
  assert.ok(d);
  assert.equal(d!.outcome, "rear_rotation");
});

test("non-setup message returns null", () => {
  assert.equal(detectOutcomeIntent("what is my fastest lap at tftr"), null);
});
