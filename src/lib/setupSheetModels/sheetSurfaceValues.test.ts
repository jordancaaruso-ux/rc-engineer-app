import assert from "node:assert/strict";
import {
  optionSelectedInSurfaceValue,
  splitMultiSurfaceValue,
  storedValuesToSurface,
  surfaceValuesToStored,
  surfaceValuesToStoredMerge,
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

// ---- A tapped tick arrives as the schema's minted VALUE and must still read as its preset ----
// The box's optionValue is `c01b_rsl` while the label prints `C01B-RSL`; treating the separator
// as a difference demoted a real tick into the "Other" box (founder report, 2026-09-01).
{
  const fields: SheetPlanField[] = [
    planField({
      key: "chassis",
      options: ["C01B-RAF", "C01B-RC", "C01RS", "C01B-RSL", "Other"],
      optionValues: ["c01b_raf", "c01b_rc", "c01rs", "c01b_rsl", "other"],
    }),
    planField({ key: "chassis_other" }),
  ];
  const stored = surfaceValuesToStored({ chassis: "c01b_rsl" }, fields);
  assert.deepEqual(stored.chassis, { selectedPreset: "C01B-RSL", otherText: "" });

  const raf = surfaceValuesToStored({ chassis: "c01b_raf" }, fields);
  assert.deepEqual(raf.chassis, { selectedPreset: "C01B-RAF", otherText: "" });

  // Genuinely unknown text still lands in Other — the demotion rule survives for real free text.
  const custom = surfaceValuesToStored({ chassis: "MXLR" }, fields);
  assert.deepEqual(custom.chassis, { selectedPreset: "", otherText: "MXLR" });
}

// ---- The tick shows: a stored LABEL selects the box that carries the minted value ----
{
  assert.equal(optionSelectedInSurfaceValue("C01B-RSL", "c01b_rsl", false), true);
  assert.equal(optionSelectedInSurfaceValue("C01B-RAF", "c01b_rsl", false), false);
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

// ---- Emptying the "custom text" box of a preset pair clears the STORED key (2026-08-29) ----
//
// "Plastic" lived in `front_bumper: { selectedPreset: "", otherText: "Plastic" }` and was drawn in
// the paper's `front_bumper_other` box. Clearing that box put the deletion marker on
// `front_bumper_other` — a key the snapshot never used — and the merge left the base object
// standing, so the text came back on the next run while every plain box he cleared stayed cleared.
{
  const fields: SheetPlanField[] = [
    planField({ key: "front_bumper", options: ["Foam", "Other"], optionValues: ["Foam", "Other"] }),
    planField({ key: "front_bumper_other" }),
    planField({ key: "ride_height_front" }),
  ];
  const surface = storedValuesToSurface({
    front_bumper: { selectedPreset: "", otherText: "Plastic" },
    ride_height_front: "5.1",
  });
  assert.equal(surface.front_bumper_other, "Plastic", "the text is drawn in the companion box");
  surface.front_bumper_other = "";
  const merge = surfaceValuesToStoredMerge(surface, fields);
  assert.equal(merge.front_bumper, "", "the marker sits on the key the snapshot stores the pair under");
  assert.equal(merge.front_bumper_other, "", "and on the box's own key, as before");
  assert.equal(merge.ride_height_front, "5.1");
  // Clearing the text while a preset is chosen keeps the preset: that is a value, not a blank.
  const kept = surfaceValuesToStoredMerge({ front_bumper: "Foam", front_bumper_other: "" }, fields);
  assert.deepEqual(kept.front_bumper, { selectedPreset: "Foam", otherText: "" });
  // A pair the surface never mentions is not touched — no marker out of nowhere.
  const untouched = surfaceValuesToStoredMerge({ ride_height_front: "5.2" }, fields);
  assert.equal("front_bumper" in untouched, false);
}

console.log("sheetSurfaceValues.test.ts OK");
