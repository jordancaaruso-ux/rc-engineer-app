/**
 * Run: `npm run test:engineer-history` (node --import tsx --test).
 *
 * What the Engineer is told moved between two sheets. A driver who swaps the body between runs
 * has made a change, and the day block must say so — before 2026-09-19 it printed "no setup
 * change" and the Engineer asked him what he had tried.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { diffTuning, isEngineerSetupKey, leversNotOnSheet, spurOverPinion, tuningValues } from "@/lib/engineer/setupDiff";

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

test("the body, the gearing and the motor are on the sheet the Engineer reads; electronics and free text still are not", () => {
  assert.deepEqual(Object.keys(tuningValues(sheet)).sort(), ["bodyshell", "damper_oil_front", "motor", "wing"]);
  assert.equal(isEngineerSetupKey("winglet"), true);
  assert.equal(isEngineerSetupKey("motor"), true);
  assert.equal(isEngineerSetupKey("pinion"), true);
  assert.equal(isEngineerSetupKey("esc"), false);
  assert.equal(isEngineerSetupKey("body_notes"), false);
});

test("a regear is a change, and spur ÷ pinion is worked out here, not by the model", () => {
  const before = tuningValues({ ...sheet, spur: 66, pinion: 39 });
  assert.deepEqual(diffTuning(before, tuningValues({ ...sheet, spur: 66, pinion: 40 })), ["pinion 39 → 40"]);
  assert.equal(spurOverPinion(before), "1.692");
  assert.equal(spurOverPinion(tuningValues({ spur_gear: "64T", pinion: 30 })), null);
  assert.equal(spurOverPinion(tuningValues(sheet)), null);
});

// An A800RR sheet as the Engineer reads it: the end-split shims, downstops for droop, a C45 brace
// for flex — and no shock holes, which is the one lever the car really lacks.
const a800rrKeys = [
  "ackermann_position", "arb_front", "arb_rear", "body_position_from_windshield", "bump_steer_shims_front",
  "c45_installed_front", "c45_installed_rear", "camber_front", "camber_rear", "caster_front",
  "damper_oil_front", "damper_oil_rear", "diff_oil", "downstop_front", "downstop_rear", "inner_steering_angle",
  "rear_hrb_setting", "ride_height_front", "ride_height_rear", "spring_front", "spring_rear", "toe_front",
  "toe_gain_shims_rear", "toe_rear", "top_deck_screws", "under_hub_shims_front", "under_hub_shims_rear",
  "under_lower_arm_shims_ff", "under_lower_arm_shims_fr", "under_lower_arm_shims_rf", "under_lower_arm_shims_rr",
  "upper_inner_shims_ff", "upper_inner_shims_fr", "upper_inner_shims_rf", "upper_inner_shims_rr",
  "upper_outer_shims_front", "upper_outer_shims_rear", "weight_balance_front_percent",
];
const levers = [
  { parameter: "shock_angle_front", label: "front shock position" },
  { parameter: "droop_front", label: "front droop" },
  { parameter: "top_deck_front", label: "front chassis flex" },
  { parameter: "upper_inner_shims_front", label: "front upper-inner shims" },
  { parameter: "under_lower_arm_shims_fr", label: "front anti-dive" },
  { parameter: "toe_rear", label: "rear toe" },
];

test("only a lever the sheet truly has no box for is called missing", () => {
  assert.deepEqual(leversNotOnSheet(levers, a800rrKeys), ["front shock position"]);
});

test("a sheet the Engineer cannot read says nothing about what the car lacks", () => {
  // Boxes nobody has named yet — most chassis in production.
  assert.deepEqual(leversNotOnSheet(levers, ["text1", "text2", "check_box4", "toe_rear"]), []);
  // A readable sheet that spells its knobs another way would look like a car with no levers at all.
  const otherSpelling = a800rrKeys.map((k) => (k.startsWith("toe_") || k.startsWith("camber_") ? k : `x_${k}`));
  assert.deepEqual(leversNotOnSheet(levers, otherSpelling, { minReadable: 3, maxMissing: 2 }), []);
});
