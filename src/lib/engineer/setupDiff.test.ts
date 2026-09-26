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
  isSettingBox,
  leversNotOnSheet,
  notVisibleLines,
  partsTheClassLacks,
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

// A Schumacher Mi10 sheet as the Engineer reads it: 20-odd boxes it knows (geometry, springs, shims)
// and some it does not (castor, shock oil), with the front bar stored as its chip's token. Test drive
// 2026-09-26: the bar went 1.3 → 1.4 and back, and the Engineer said "no setup change" three times.
const mi10 = {
  ...Object.fromEntries(a800rrKeys.filter((k) => !k.startsWith("arb_")).slice(0, 22).map((k) => [k, "1"])),
  anti_roll_bar_front: "f_1_3",
  castor_front: "4",
  shock_oil_front: "400",
  battery: "LCG 6000",
  notes: "rear felt loose",
  date: "2026-09-26",
};
const mi10Chips = {
  anti_roll_bar_front: { options: ["1.1", "1.2", "1.3", "1.4"], optionValues: ["f_1_1", "f_1_2", "f_1_3", "f_1_4"] },
};

test("the Mi10's front bar is a roll bar the Engineer reads, and its chip token reads as the chip", () => {
  assert.equal(isEngineerSetupKey("anti_roll_bar_front"), true);
  assert.equal(isEngineerSetupKey("anti_roll_bar_rear"), true);
  assert.equal(sheetMostlyUnread(readSheet(mi10)), false, "the Mi10 is a sheet the Engineer reads");
  const moved = { ...mi10, anti_roll_bar_front: "f_1_4" };
  assert.equal(readSheet(mi10, null, mi10Chips).read.anti_roll_bar_front, "1.3");
  assert.equal(
    changedWords(diffSheet(readSheet(mi10, null, mi10Chips), readSheet(moved, null, mi10Chips))!, 8),
    "anti roll bar front 1.3 → 1.4"
  );
  // Without the sheet's chips it is still a change, never "no setup change".
  assert.equal(changedWords(diffSheet(readSheet(mi10), readSheet(moved))!, 8), "anti roll bar front f_1_3 → f_1_4");
  // And the car is never told it has no front bar.
  const keys = Object.keys(mi10);
  assert.deepEqual(leversNotOnSheet([{ parameter: "arb_front", label: "front anti-roll bar" }], keys), []);
});

test("on a sheet the Engineer reads, a setting it cannot read that moved is a box not shown, never no setup change", () => {
  const castor = diffSheet(readSheet(mi10), readSheet({ ...mi10, castor_front: "5" }))!;
  assert.deepEqual(castor, { changes: [], unread: 1 });
  assert.equal(changedWords(castor, 8, "sheet-abc123"), "only [1 box not shown here](#sheet-abc123)");
  const both = diffSheet(readSheet(mi10), readSheet({ ...mi10, castor_front: "5", shock_oil_front: "450", diff_oil: "2" }))!;
  assert.equal(changedWords(both, 8), "diff oil 1 → 2, and 2 boxes not shown here");
  // A box the driver has named reads by that name, as on a sheet the Engineer barely reads.
  const names = { castor_front: "front castor" };
  const named = diffSheet(readSheet(mi10, names), readSheet({ ...mi10, castor_front: "5" }, names))!;
  assert.equal(changedWords(named, 8), "front castor (named by the driver) 4 → 5");
});

test("the tyres, the battery, the notes and who, when and where are never a setup change, on any sheet", () => {
  const notSettings = { ...mi10, battery: "LCG 7000", notes: "better", date: "2026-09-27", tyres_front: "Sweep 32" };
  assert.equal(changedWords(diffSheet(readSheet(mi10), readSheet(notSettings))!, 8), null);
  // Counted the same way on a sheet the Engineer barely reads: the named battery box stays out.
  const x4Day = diffSheet(readSheet({ ...x4, battery: "A" }), readSheet({ ...x4, battery: "B", text20: "1.1" }))!;
  assert.equal(changedWords(x4Day, 8), "only 1 box not shown here");
  for (const key of ["battery", "tires", "tires_setup", "additive", "rear_tyres", "notes", "setup_date", "track_layout"]) {
    assert.equal(isSettingBox(key), false, key);
  }
  for (const key of ["tire_insert_front", "track_width_front", "castor_front", "shock_oil_front", "text20"]) {
    assert.equal(isSettingBox(key), true, key);
  }
});

test("a chip token reads as its chip only where the sheet's chips say so", () => {
  const chips = {
    diff_height_front: { options: ["Down", "Up"], optionValues: ["down", "up"] },
    toe_front: { options: ["a", "b"], optionValues: ["x"] },
  };
  const sheet = readSheet({ diff_height_front: "down", toe_front: "x", wing: "f_1_3" }, null, chips);
  assert.equal(sheet.read.diff_height_front, "down", "a token that differs only by case stays as stored");
  assert.equal(sheet.read.toe_front, "x", "labels and tokens that don't line up are not trusted");
  assert.equal(sheet.read.wing, "f_1_3", "a box with no chips stays as stored");
});

test("with nothing on the run, the Engineer is told what the driver can do about it, never to fill in a sheet they have or lack", () => {
  // A setup saved on the car: pick it on the run (test drive: "until you fill in its setup sheet").
  assert.match(notVisibleLines(0, { savedSetups: 1, hasSheet: true })[0], /^No setup is attached to this run\. The driver has 1 saved setup for this car and can pick one on the run/);
  assert.match(notVisibleLines(0, { savedSetups: 3, hasSheet: true })[0], /has 3 saved setups/);
  // No sheet in the app at all ("I don't have the sheet").
  const noSheet = notVisibleLines(0, { savedSetups: 0, hasSheet: false })[0];
  assert.equal(noSheet, "This car has no setup sheet in the app, so none of its settings can be seen unless the driver says them.");
  assert.doesNotMatch(noSheet, /fill/i);
  // A sheet and nothing saved, or nothing known about the car: as before.
  assert.match(notVisibleLines(0, { savedSetups: 0, hasSheet: true })[0], /^The driver has not filled in a setup sheet for this car\./);
  assert.deepEqual(notVisibleLines(0), notVisibleLines(0, { hasSheet: true }));
  // Boxes filled on a sheet the app can't read yet: unchanged, whatever is saved.
  assert.match(notVisibleLines(12, { savedSetups: 2 })[0], /^The driver filled in 12 boxes/);
});

test("a pan car and a formula car have no roll bars and no rear toe or camber; no other class is told so", () => {
  for (const d of ["pan-12th~electric", "pan-10th~electric", "pan-12th", "formula~electric"]) {
    const fact = partsTheClassLacks(d) ?? "";
    assert.match(fact, /^THIS CAR HAS NO anti-roll bars, and no rear toe or rear camber to adjust/, d);
    assert.match(fact, /the rear pod \(side springs or links, the centre damper, droop\)/, d);
  }
  assert.match(partsTheClassLacks("pan-12th~electric")!, /on a pan car the rear axle is solid, in a pod/);
  assert.match(partsTheClassLacks("formula~electric")!, /on a formula car the rear axle is solid, in a pod/);
  for (const d of ["touring~electric", "buggy-8th-4wd~nitro", "pan-8th~electric", "gt-8th~nitro", "other-onroad~electric~pan", "", null]) {
    assert.equal(partsTheClassLacks(d), null, String(d));
  }
});
