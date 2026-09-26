import { test } from "node:test";
import assert from "node:assert/strict";
import { comparedSetupDifferences, heldCompareHighlightKeys } from "./heldCompareHighlight";

const lit = (a: Record<string, unknown>, b: Record<string, unknown>) => [...heldCompareHighlightKeys(a, b)].sort();

test("two identical setups light nothing", () => {
  const setup = { camber_front: "-2", toe_rear: "3", damper_oil_front: "400" };
  assert.deepEqual(lit(setup, { ...setup }), []);
});

test("every box that differs lights, not a chosen few", () => {
  assert.deepEqual(
    lit(
      { camber_front: "-2", toe_rear: "3.5", pinion: "52", battery: "EAM 7000" },
      { camber_front: "-1.5", toe_rear: "3", pinion: "42", battery: "EAM 6400 #1" }
    ),
    ["battery", "camber_front", "pinion", "toe_rear"]
  );
});

test("a box one side left empty is a difference too", () => {
  assert.deepEqual(lit({ camber_front: "-2" }, { camber_front: "-2", esc: "HW G3X" }), ["esc"]);
});

test("the sheet's header and the tyres never light, exactly as the list drops them", () => {
  assert.deepEqual(
    lit(
      { track: "TFTR", date: "19.4.26", race: "Testing", camber_front: "-2" },
      { track: "Bayside", date: "23.5.26", race: "Club day", camber_front: "-1.5" }
    ),
    ["camber_front"]
  );
});

test("a preset that moved to its 'other' line lights both the ticks and the line", () => {
  assert.deepEqual(
    lit(
      { chassis: { selectedPreset: "", otherText: "Titanium" } },
      { chassis: { selectedPreset: "C01RS", otherText: "" } }
    ),
    ["chassis", "chassis_other"]
  );
});

test("a preset that moved between ticks leaves its empty 'other' line dark", () => {
  assert.deepEqual(
    lit(
      { chassis: { selectedPreset: "C01RS", otherText: "" } },
      { chassis: { selectedPreset: "C01B-RC", otherText: "" } }
    ),
    ["chassis"]
  );
});

test("the lit boxes and the differences list name the same fields", () => {
  const a = { camber_front: "-2", toe_rear: "3.5", track: "TFTR", spur: "88", esc: "" };
  const b = { camber_front: "-1.5", toe_rear: "3.5", track: "Bayside", spur: "100", esc: "HW G3X" };
  assert.deepEqual(
    comparedSetupDifferences(a, b).map((row) => row.key).sort(),
    lit(a, b)
  );
});
