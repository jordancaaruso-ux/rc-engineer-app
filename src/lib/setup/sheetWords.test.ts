import test from "node:test";
import assert from "node:assert/strict";
import { inSheetWords, sheetLabel, sheetValue, sheetWordsFromFields } from "./sheetWords";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import { setupChangesSinceLoaded } from "@/lib/setup/setupChangesSinceLoaded";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

function field(input: Partial<SetupSheetModelFieldDef> & { key: string; displayLabel: string }): SetupSheetModelFieldDef {
  return {
    sectionId: "grp_other",
    sectionTitle: "Other",
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 0,
    ...input,
  };
}

/** The Mi10's front bar as the test drive met it: buttons 1.1 to 1.4, stored as f_1_1 to f_1_4. */
const MI10_ARB_FRONT = field({
  key: "anti_roll_bar_front",
  displayLabel: "Anti Roll Bar (Front)",
  groupBehaviorType: "singleChoiceGroup",
  groupedOptionLabels: ["1.1", "1.2", "1.3", "1.4"],
  groupedOptionValues: ["f_1_1", "f_1_2", "f_1_3", "f_1_4"],
});
const RIDE_HEIGHT = field({ key: "ride_height_front", displayLabel: "Ride height (F)", unit: "mm" });

test("a sheet's own names, and the printed word for each stored choice", () => {
  const words = sheetWordsFromFields([MI10_ARB_FRONT, RIDE_HEIGHT]);
  assert.equal(words.labels.anti_roll_bar_front, "Anti Roll Bar (Front)");
  assert.equal(words.units.ride_height_front, "mm");
  assert.equal(sheetValue(words, "anti_roll_bar_front", "f_1_3"), "1.3");
  // Compared the way the sheet compares choices: case and hyphen/underscore do not matter.
  assert.equal(sheetValue(words, "anti_roll_bar_front", "F-1-4"), "1.4");
});

test("values the sheet has no word for come back exactly as they went in", () => {
  const words = sheetWordsFromFields([MI10_ARB_FRONT, RIDE_HEIGHT]);
  assert.equal(sheetValue(words, "anti_roll_bar_front", "—"), "—");
  assert.equal(sheetValue(words, "anti_roll_bar_front", "2.0"), "2.0");
  assert.equal(sheetValue(words, "ride_height_front", "5.5"), "5.5");
  assert.equal(sheetValue(words, "not_on_this_sheet", "f_1_3"), "f_1_3");
  assert.equal(sheetValue(null, "anti_roll_bar_front", "f_1_3"), "f_1_3");
  // The words arrive as parsed JSON: a box or a value called "constructor" is not the object's own.
  const parsed = JSON.parse(JSON.stringify(words)) as typeof words;
  assert.equal(sheetLabel(parsed, "constructor"), null);
  assert.equal(sheetValue(parsed, "constructor", "toString"), "toString");
  assert.equal(sheetValue(parsed, "anti_roll_bar_front", "constructor"), "constructor");
});

test("a many-of-many value reads choice by choice", () => {
  const words = sheetWordsFromFields([
    field({
      key: "holes",
      displayLabel: "Holes",
      uiType: "multiSelect",
      groupedOptionLabels: ["1.5", "2.5", "3.5"],
      groupedOptionValues: ["f_1_5", "f_2_5", "f_3_5"],
    }),
  ]);
  assert.equal(sheetValue(words, "holes", "f_1_5, f_3_5"), "1.5, 3.5");
  assert.equal(sheetValue(words, "holes", "f_1_5, typed by hand"), "1.5, typed by hand");
  assert.equal(sheetValue(words, "holes", "a, b"), "a, b");
});

test("choices already stored as their printed word add nothing", () => {
  const words = sheetWordsFromFields([
    field({ key: "surface", displayLabel: "Surface", groupedOptionLabels: ["Carpet", "Asphalt"], groupedOptionValues: ["Carpet", "Asphalt"] }),
    // The A800RR stores the printed name; its schema mints a slug. The same choice either way.
    field({ key: "chassis", displayLabel: "Chassis", groupedOptionLabels: ["C01B-RSL", "C01B-RAF"], groupedOptionValues: ["c01b_rsl", "c01b_raf"] }),
  ]);
  assert.equal(words.options.surface, undefined);
  assert.equal(words.options.chassis, undefined);
  assert.equal(sheetValue(words, "chassis", "C01B-RSL"), "C01B-RSL");
});

test("a choice row with labels but no stored values reads through the values the app mints", () => {
  const words = sheetWordsFromFields([
    field({ key: "arb_rear", displayLabel: "Anti Roll Bar (Rear)", groupedOptionLabels: ["1.1", "1.2"] }),
  ]);
  assert.equal(sheetValue(words, "arb_rear", "f_1_2"), "1.2");
});

test("a later field list wins for its keys — an edition's names over the chassis's", () => {
  const words = sheetWordsFromFields([
    RIDE_HEIGHT,
    field({ key: "ride_height_front", displayLabel: "Front ride height", unit: "in" }),
    MI10_ARB_FRONT,
    field({ key: "anti_roll_bar_front", displayLabel: "Front bar" }),
  ]);
  assert.equal(sheetLabel(words, "ride_height_front"), "Front ride height (in)");
  assert.equal(sheetLabel(words, "anti_roll_bar_front"), "Front bar");
  assert.equal(words.options.anti_roll_bar_front, undefined, "the edition's field has no choices");
});

test("only the boxes asked about", () => {
  const words = sheetWordsFromFields([MI10_ARB_FRONT, RIDE_HEIGHT], new Set(["ride_height_front"]));
  assert.deepEqual(Object.keys(words.labels), ["ride_height_front"]);
  assert.deepEqual(words.options, {});
});

test("change-list rows in the sheet's words, unit the way setupFieldLabel adds one", () => {
  const words = sheetWordsFromFields([MI10_ARB_FRONT, RIDE_HEIGHT]);
  const rows = inSheetWords(
    [
      { key: "anti_roll_bar_front", label: "anti roll bar front", value: "f_1_4", previousValue: "f_1_3" },
      { key: "ride_height_front", label: "ride height front", value: "6", previousValue: "5.5" },
      { key: "wing", label: "wing", value: "High", previousValue: "Low" },
    ],
    words
  );
  assert.deepEqual(
    rows.map((r) => `${r.label}: ${r.previousValue} → ${r.value}`),
    ["Anti Roll Bar (Front): 1.3 → 1.4", "Ride height (F) (mm): 5.5 → 6", "wing: Low → High"]
  );
  assert.equal(inSheetWords(rows, null), rows);
});

test("the dashboard's change rows read the car's sheet (test drive 2026-09-26)", () => {
  const words = sheetWordsFromFields([MI10_ARB_FRONT, RIDE_HEIGHT]);
  const now = { anti_roll_bar_front: "f_1_4", ride_height_front: 5.5 };
  const was = { anti_roll_bar_front: "f_1_3", ride_height_front: 5.5 };

  // What it printed before: the key and the stored codes.
  const bare = buildSetupDiffRows(now, was).find((r) => r.key === "anti_roll_bar_front");
  assert.equal(`${bare?.label} ${bare?.previous} → ${bare?.current}`, "anti roll bar front f_1_3 → f_1_4");

  const rows = buildSetupDiffRows(now, was, words);
  const bar = rows.find((r) => r.key === "anti_roll_bar_front");
  assert.equal(`${bar?.label} ${bar?.previous} → ${bar?.current}`, "Anti Roll Bar (Front) 1.3 → 1.4");
  assert.equal(bar?.changed, true);
  assert.equal(bar?.unit, "", "neither the sheet nor the app has a unit for the bar");

  const height = rows.find((r) => r.key === "ride_height_front");
  assert.equal(height?.label, "Ride height (F)");
  assert.equal(height?.unit, "mm");
  assert.equal(height?.changed, false, "whether a row changed is still decided on the stored values");
});

test("a sheet that names a box but gives no unit keeps the unit the lists always printed", () => {
  const words = sheetWordsFromFields([field({ key: "camber_front", displayLabel: "Camber F" })]);
  const [camber] = buildSetupDiffRows({ camber_front: -1.5 }, { camber_front: -1 }, words);
  assert.equal(camber?.label, "Camber F");
  assert.equal(camber?.unit, "°");
  const [row] = inSheetWords([{ key: "camber_front", label: "Camber (Front) (°)", value: "-1.5", previousValue: "-1" }], words);
  assert.equal(row?.label, "Camber F (°)");
});

test("a key the sheet does not name keeps the names the diff always had", () => {
  const words = sheetWordsFromFields([MI10_ARB_FRONT]);
  const [camber] = buildSetupDiffRows({ camber_front: -1.5 }, { camber_front: -1 }, words);
  const [camberBare] = buildSetupDiffRows({ camber_front: -1.5 }, { camber_front: -1 });
  assert.deepEqual(camber, camberBare);
});

test("Log run's \"Setup is from … with the following changes\" reads the car's sheet", () => {
  const words = sheetWordsFromFields([MI10_ARB_FRONT, RIDE_HEIGHT]);
  const loaded = { anti_roll_bar_front: "f_1_3", ride_height_front: 5.5 };
  const now = { anti_roll_bar_front: "f_1_4", ride_height_front: 5.5 };
  const rows = setupChangesSinceLoaded(now, loaded, words);
  assert.deepEqual(
    rows.map((r) => `${r.label} ${r.previous} → ${r.current}`),
    ["Anti Roll Bar (Front) 1.3 → 1.4"]
  );
  // The count is the same with or without the words: a change is decided on the stored values.
  assert.equal(setupChangesSinceLoaded(now, loaded).length, rows.length);
});
