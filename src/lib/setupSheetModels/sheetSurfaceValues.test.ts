import assert from "node:assert/strict";
import {
  optionSelectedInSurfaceValue,
  splitMultiSurfaceValue,
  storedValuesToSurface,
  surfaceValuesToStored,
  toggleOptionInSurfaceValue,
} from "@/lib/setupSheetModels/sheetSurfaceValues";
import type { SheetPlanField } from "@/lib/setupSheetModels/sheetPlan";

function planField(p: Partial<SheetPlanField> & { key: string }): SheetPlanField {
  return { label: p.key, unnamed: false, uiType: "text", ...p } as SheetPlanField;
}

// ---- Stored → surface: every real shape from Jordan's own snapshots, 2026-08-11 ----
{
  const surface = storedValuesToSurface({
    camber_front: -1.5,
    damping_front: "Linear",
    at15_front: "1",
    track_layout: ["technical"],
    top_deck_cuts: ["a", "b", "c", "d"],
    chassis: { otherText: "", selectedPreset: "C01RS" },
    top_deck_front: { otherText: "G", selectedPreset: "c127s" },
    front_bumper: { otherText: "Plastic", selectedPreset: "" },
    notes: "To Test",
    empty: "",
    nothing: null,
  });
  assert.equal(surface.camber_front, "-1.5");
  assert.equal(surface.damping_front, "Linear");
  assert.equal(surface.at15_front, "1");
  assert.equal(surface.track_layout, "technical");
  assert.equal(surface.top_deck_cuts, "a, b, c, d");
  assert.equal(surface.chassis, "C01RS");
  assert.equal(surface.chassis_other, undefined, "no free text typed");
  assert.equal(surface.top_deck_front, "c127s");
  assert.equal(surface.top_deck_front_other, "G");
  assert.equal(surface.front_bumper, undefined, "no preset picked");
  assert.equal(surface.front_bumper_other, "Plastic");
  assert.equal(surface.notes, "To Test");
  assert.ok(!("empty" in surface) && !("nothing" in surface));
}

// ---- Selection tests are case-insensitive, because stored casing drifts ----
{
  assert.equal(optionSelectedInSurfaceValue("c127s", "C127S", false), true);
  assert.equal(optionSelectedInSurfaceValue("Linear", "Progressive", false), false);
  assert.equal(optionSelectedInSurfaceValue("a, b, d", "B", true), true);
  assert.equal(optionSelectedInSurfaceValue("a, b, d", "c", true), false);
  assert.equal(optionSelectedInSurfaceValue("", "Up", false), false);
}

// ---- Toggling: single re-tap clears; multi adds and removes membership ----
{
  assert.equal(toggleOptionInSurfaceValue("", "Up", false), "Up");
  assert.equal(toggleOptionInSurfaceValue("Up", "up", false), "");
  assert.equal(toggleOptionInSurfaceValue("Up", "Down", false), "Down");
  assert.equal(toggleOptionInSurfaceValue("a, b", "c", true), "a, b, c");
  assert.equal(toggleOptionInSurfaceValue("a, b, c", "B", true), "a, c");
  assert.deepEqual(splitMultiSurfaceValue(" a ,b,  "), ["a", "b"]);
}

// ---- Surface → stored: the shapes every other setup reader expects ----
{
  const fields: SheetPlanField[] = [
    planField({ key: "camber_front" }),
    planField({
      key: "top_deck_cuts",
      uiType: "text",
      options: ["A", "B", "C"],
      optionValues: ["a", "b", "c"],
      multi: true,
    }),
    planField({
      key: "damping_front",
      options: ["Linear", "Progressive"],
      optionValues: ["Linear", "Progressive"],
    }),
    planField({
      key: "chassis",
      options: ["C01RS", "C01B-RC", "Other"],
      optionValues: ["C01RS", "C01B-RC", "Other"],
    }),
    planField({ key: "chassis_other" }),
    planField({
      key: "front_bumper",
      options: ["C07R", "C07RF", "Other"],
      optionValues: ["C07R", "C07RF", "Other"],
    }),
    planField({ key: "front_bumper_other" }),
  ];

  const stored = surfaceValuesToStored(
    {
      camber_front: "-1.5",
      top_deck_cuts: "A, c",
      damping_front: "linear",
      chassis: "C01RS",
      chassis_other: "",
      front_bumper: "",
      front_bumper_other: "Plastic",
      left_blank: "",
    },
    fields
  );
  assert.equal(stored.camber_front, "-1.5");
  // Multi comes back as an ARRAY in the schema's casing, exactly as the form stores it.
  assert.deepEqual(stored.top_deck_cuts, ["a", "c"]);
  assert.equal(stored.damping_front, "Linear");
  assert.deepEqual(stored.chassis, { selectedPreset: "C01RS", otherText: "" });
  assert.deepEqual(stored.front_bumper, { selectedPreset: "", otherText: "Plastic" });
  assert.ok(!("chassis_other" in stored), "companion composes into the base, never stored alone");
  assert.ok(!("front_bumper_other" in stored));
  assert.ok(!("left_blank" in stored));
}

// ---- Round trip: a stored setup survives surface and back unchanged in meaning ----
{
  const fields: SheetPlanField[] = [
    planField({
      key: "top_deck_cuts",
      options: ["A", "B", "C", "D"],
      optionValues: ["a", "b", "c", "d"],
      multi: true,
    }),
    planField({
      key: "top_deck_front",
      options: ["C127", "C127S", "Other"],
      optionValues: ["C127", "C127S", "Other"],
    }),
    planField({ key: "top_deck_front_other" }),
    planField({ key: "ride_height_front" }),
  ];
  const original = {
    top_deck_cuts: ["a", "b", "c", "d"],
    top_deck_front: { otherText: "G", selectedPreset: "c127s" },
    ride_height_front: "5.1",
  };
  const back = surfaceValuesToStored(storedValuesToSurface(original), fields);
  assert.deepEqual(back.top_deck_cuts, ["a", "b", "c", "d"]);
  // Casing canonicalizes to the schema's option ("C127S"); the change list compares
  // case-insensitively through normalizePresetWithOtherFromUnknown, so meaning is preserved.
  assert.deepEqual(back.top_deck_front, { selectedPreset: "C127S", otherText: "G" });
  assert.equal(back.ride_height_front, "5.1");
}

console.log("sheetSurfaceValues.test.ts ok");
