/**
 * Run: `npm run test:engineer-history` (node --import tsx --test).
 *
 * What the Engineer is told moved between two sheets. A driver who swaps the body between runs
 * has made a change, and the day block must say so — before 2026-09-19 it printed "no setup
 * change" and the Engineer asked him what he had tried.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changedWords,
  diffSheet,
  diffTuning,
  isEngineerSetupKey,
  leversNotOnSheet,
  readSheet,
  sheetMostlyUnread,
  spurOverPinion,
  tuningValues,
} from "@/lib/engineer/setupDiff";

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

// An Xray X4-style sheet: the Engineer reads the gearing and the motor; the springs and the bar sit
// in boxes the app has not named yet. Until 2026-09-24 a run where those moved printed "no setup change".
const x4 = { pinion: 39, spur: 66, motor: "21.5", text20: "1", text34: "12", text41: "450" };

test("a sheet the Engineer barely reads never says nothing moved when a box it cannot read did", () => {
  const change = diffSheet(readSheet(x4), readSheet({ ...x4, text20: "1.1", text34: "14" }));
  assert.deepEqual(change, { changes: [], unread: 2 });
  assert.equal(changedWords(change!, 8), "only 2 boxes not shown here");
  const regear = diffSheet(readSheet(x4), readSheet({ ...x4, pinion: 40, text20: "1.1" }));
  assert.equal(changedWords(regear!, 8), "pinion 39 → 40, and 1 box not shown here");
});

test("nothing moved anywhere on the sheet is still no setup change; nothing filled in on one side is unknown", () => {
  assert.equal(changedWords(diffSheet(readSheet(x4), readSheet({ ...x4 }))!, 8), null);
  assert.equal(diffSheet(readSheet({}), readSheet(x4)), null);
  // A sheet with no box the Engineer can read at all counts its boxes the same way.
  assert.deepEqual(diffSheet(readSheet({ text1: "a", text2: "3" }), readSheet({ text1: "a", text2: "4" })), { changes: [], unread: 1 });
});

test("on a sheet the Engineer reads, the boxes it is not shown do not count — they are the tyres and the battery", () => {
  const readable = Object.fromEntries(a800rrKeys.slice(0, 20).map((k) => [k, "1"]));
  const sheet = { ...readable, tires: "Matrix Z36 #1", battery: "EAM 7000 #1" };
  assert.equal(sheetMostlyUnread(readSheet(sheet)), false);
  assert.equal(sheetMostlyUnread(readSheet(x4)), true);
  const newTyres = diffSheet(readSheet(sheet), readSheet({ ...sheet, tires: "Matrix Z36 #2" }));
  assert.deepEqual(newTyres, { changes: [], unread: 0 });
  assert.equal(changedWords(newTyres!, 8), null);
  assert.equal(changedWords(diffSheet(readSheet(sheet), readSheet({ ...sheet, arb_front: "1.1", tires: "x" }))!, 8), "arb front 1 → 1.1");
});
