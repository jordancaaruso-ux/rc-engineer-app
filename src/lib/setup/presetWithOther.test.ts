/**
 * Run: `npx tsx --test src/lib/setup/presetWithOther.test.ts`
 *
 * Preset+free-text is an Awesomatix A800 sheet shape. These pin that it is scoped by the *sheet*,
 * not by the key name: an X-Ray calibration is allowed to use `chassis` as a plain one-of-many, and
 * used to get the A800 editor — chip unselected, "GRAPHITE" dumped into a stray custom-text box.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fieldUsesPresetWithOther,
  getPresetWithOtherFromData,
} from "@/lib/setup/presetWithOther";

/** X-Ray X4'26 bottom-view chassis material — three boxes, no free-text line. */
const XRAY_CHASSIS_OPTIONS = ["GRAPHITE", "ALU", "ALU 1.5mm"];
/** A800 chassis — three part numbers plus the sheet's own "Other: ___" line. */
const A800_CHASSIS_OPTIONS = ["C01B-RAF", "C01B-RC", "C01RS", "Other"];

test("a model sheet with no Other option gets a plain choice field", () => {
  assert.equal(fieldUsesPresetWithOther("chassis", XRAY_CHASSIS_OPTIONS), false);
});

test("a model sheet that declares Other keeps the preset + free-text shape", () => {
  assert.equal(fieldUsesPresetWithOther("chassis", A800_CHASSIS_OPTIONS), true);
});

test("no model schema to ask (legacy A800 template) keeps the shape", () => {
  assert.equal(fieldUsesPresetWithOther("chassis", null), true);
  assert.equal(fieldUsesPresetWithOther("top_deck_single", undefined), true);
});

test("a key that was never preset+other never gains a free-text box", () => {
  assert.equal(fieldUsesPresetWithOther("arb_front", null), false);
  assert.equal(fieldUsesPresetWithOther("arb_front", ["1.1", "1.2", "Other"]), false);
});

test("a preset key defined with no options at all is plain", () => {
  assert.equal(fieldUsesPresetWithOther("front_bumper", []), false);
});

test("Other is matched case- and space-insensitively", () => {
  assert.equal(fieldUsesPresetWithOther("chassis", ["C01RS", " OTHER "]), true);
});

test("the A800 option list still parses its own values into preset vs free text", () => {
  const preset = getPresetWithOtherFromData({ chassis: "C01RS" }, "chassis", A800_CHASSIS_OPTIONS);
  assert.deepEqual(preset, { selectedPreset: "C01RS", otherText: "" });

  // The mechanism behind the X-Ray bug: an option the A800 list has never heard of becomes free text.
  const foreign = getPresetWithOtherFromData({ chassis: "GRAPHITE" }, "chassis", A800_CHASSIS_OPTIONS);
  assert.deepEqual(foreign, { selectedPreset: "", otherText: "GRAPHITE" });
});
