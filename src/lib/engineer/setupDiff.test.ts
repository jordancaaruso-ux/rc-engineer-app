/**
 * Run: `npm run test:engineer-history` (node --import tsx --test).
 *
 * What the Engineer is told moved between two sheets. A driver who swaps the body between runs
 * has made a change, and the day block must say so — before 2026-09-19 it printed "no setup
 * change" and the Engineer asked him what he had tried.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { diffTuning, isEngineerSetupKey, tuningValues } from "@/lib/engineer/setupDiff";

const sheet = { bodyshell: "Twister", wing: "Std", damper_oil_front: "450", motor: "21.5", body_notes: "trimmed" };

test("a body-only change is a change", () => {
  const changes = diffTuning(tuningValues(sheet), tuningValues({ ...sheet, bodyshell: "Anti" }));
  assert.deepEqual(changes, ["bodyshell Twister → Anti"]);
});

test("the wing reads the same way, and recasing it is not a change", () => {
  assert.deepEqual(diffTuning(tuningValues(sheet), tuningValues({ ...sheet, wing: "High downforce" })), [
    "wing Std → High downforce",
  ]);
  assert.deepEqual(diffTuning(tuningValues(sheet), tuningValues({ ...sheet, wing: "STD" })), []);
});

test("the body is on the sheet the Engineer reads; electronics and free text still are not", () => {
  assert.deepEqual(Object.keys(tuningValues(sheet)).sort(), ["bodyshell", "damper_oil_front", "wing"]);
  assert.equal(isEngineerSetupKey("winglet"), true);
  assert.equal(isEngineerSetupKey("motor"), false);
  assert.equal(isEngineerSetupKey("body_notes"), false);
});
