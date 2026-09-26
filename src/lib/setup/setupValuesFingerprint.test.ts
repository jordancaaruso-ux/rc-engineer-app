import test from "node:test";
import assert from "node:assert/strict";
import { changedSetupKeys, setupValuesFingerprint } from "./setupValuesFingerprint";
import { setupChangesSinceLoaded, setupHasUnsavedChanges } from "./setupChangesSinceLoaded";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import {
  mergeSheetValuesIntoSnapshot,
  sheetValuesFromSnapshot,
} from "@/lib/setupSheetModels/sheetValues";
import { surfaceValuesToStoredMerge } from "@/lib/setupSheetModels/sheetSurfaceValues";

const same = (a: unknown, b: unknown) =>
  setupValuesFingerprint(a) === setupValuesFingerprint(b);

test("the same setup handed back is not a change", () => {
  const opened = { camber_front: -1.5, ride_height_rear: 5.5, tire: "Sweep 40R" };
  assert.equal(same(opened, { ...opened }), true);
  assert.deepEqual(changedSetupKeys(opened, { ...opened }), []);
});

test("key order and unfilled boxes carry no meaning", () => {
  assert.equal(
    same(
      { b: "2", a: "1" },
      { a: "1", b: "2", spring_front: "", droop_front: null, notes: undefined, screws: [] }
    ),
    true
  );
});

test("a number typed back in the way it was already stored is not a change", () => {
  // The grid editor commits on blur whatever happened, so this is the stray-tap case.
  assert.equal(same({ ride_height_rear: 5.5 }, { ride_height_rear: "5.50" }), true);
  assert.equal(same({ ride_height_rear: 5.5 }, { ride_height_rear: " 5.5 " }), true);
});

test("a tick going on and back off lands where it started", () => {
  assert.equal(same({ droop_screw: "1" }, { droop_screw: true }), true);
  assert.equal(same({ droop_screw: "" }, { droop_screw: false }), true);
  assert.equal(same({ droop_screw: "1" }, { droop_screw: "" }), false);
});

test("a real edit is a change, and it names the box", () => {
  const opened = { camber_front: -1.5, ride_height_rear: 5.5 };
  const edited = { camber_front: -2, ride_height_rear: 5.5 };
  assert.equal(same(opened, edited), false);
  assert.deepEqual(changedSetupKeys(opened, edited), ["camber_front"]);
});

test("filling a box that was empty, and emptying one that was filled, both count", () => {
  assert.deepEqual(changedSetupKeys({ toe_rear: "" }, { toe_rear: "3" }), ["toe_rear"]);
  assert.deepEqual(changedSetupKeys({ toe_rear: "3" }, {}), ["toe_rear"]);
});

test("text keeps its case, because rewriting a tyre name really would be written", () => {
  assert.equal(same({ tire: "sweep 40r" }, { tire: "Sweep 40R" }), false);
});

test("screw lists compare in order, since their order is the answer", () => {
  assert.equal(same({ top_deck_screws: ["a", "b"] }, { top_deck_screws: ["a", "b"] }), true);
  assert.equal(same({ top_deck_screws: ["a", "b"] }, { top_deck_screws: ["b", "a"] }), false);
});

test("nested preset values compare by what they resolve to", () => {
  assert.equal(
    same(
      { spring_front: { preset: "c127s", other: "" } },
      { spring_front: { other: null, preset: "c127s" } }
    ),
    true
  );
  assert.equal(
    same({ spring_front: { preset: "c127s" } }, { spring_front: { preset: "c127b" } }),
    false
  );
});

test("several edits count several times", () => {
  assert.equal(
    changedSetupKeys(
      { camber_front: -1.5, ride_height_rear: 5.5, diff_oil: 7000 },
      { camber_front: -2, ride_height_rear: 6, diff_oil: 7000 }
    ).length,
    2
  );
});

// --- The run form's "N changes since loaded" (`setupChangesSinceLoaded`) ------------------------
//
// Test drive 2026-09-26: one box changed on a Schumacher Mi10 read "2 changes since loaded", and
// putting it back read "1". The setup was a copied manufacturer baseline, which keeps `chassis` as
// a preset-with-other object; the sheet draws that as a `chassis_other` box and every edit hands
// it back as a plain string the loaded setup never had.

/** A setup as the run form loads it: normalised, with its derived boxes worked out. */
const loadIntoForm = (raw: Record<string, unknown>) =>
  applyDerivedFieldsToSnapshot(normalizeSetupData(raw));

/** One report from the sheet: the whole surface handed back and merged, as the form does it. */
const sheetReport = (form: SetupSnapshotData, surface: Record<string, string>) =>
  applyDerivedFieldsToSnapshot(
    mergeSheetValuesIntoSnapshot(form, surfaceValuesToStoredMerge(surface, []))
  );

const MI10_BASELINE = {
  chassis: { selectedPreset: "", otherText: "st" },
  anti_roll_bar_front: "f_1_3",
  toe_front: -1,
  camber_front: -2,
  motor_mount_screws: ["2", "3", "4"],
  top_deck_screws_front: ["b"],
  hex_width_front: "kit",
};

test("one box changed on the sheet is one change, and putting it back is none", () => {
  const loaded = loadIntoForm(MI10_BASELINE);
  const surface = sheetValuesFromSnapshot(loaded);
  const once = sheetReport(loaded, { ...surface, anti_roll_bar_front: "f_1_4" });
  assert.deepEqual(
    setupChangesSinceLoaded(once, loaded).map((r) => r.key),
    ["anti_roll_bar_front"]
  );
  const back = sheetReport(once, { ...surface, anti_roll_bar_front: "f_1_3" });
  assert.deepEqual(setupChangesSinceLoaded(back, loaded), []);
});

test("the tyre and the boxes the sheet works out are never counted", () => {
  // Final drive follows spur and pinion: one changed spur is one change, not two.
  const loaded = loadIntoForm({ spur: 84, pinion: 30, toe_rear: 3 });
  const current = loadIntoForm({
    spur: 86,
    pinion: 30,
    toe_rear: 3,
    tires: { tireTypeId: "t1", displayName: "Blue", tireRunNumber: 1, tireAgeKnown: true },
  });
  assert.deepEqual(setupChangesSinceLoaded(current, loaded).map((r) => r.key), ["spur"]);
});

test("clearing a box that had a value is a change", () => {
  const loaded = loadIntoForm({ toe_rear: 3, camber_front: -2 });
  assert.deepEqual(
    setupChangesSinceLoaded({ ...loaded, toe_rear: "" }, loaded).map((r) => r.key),
    ["toe_rear"]
  );
});

test("nothing loaded, nothing to count", () => {
  assert.deepEqual(setupChangesSinceLoaded({ toe_rear: 3 }, null), []);
});

// --- "Save to this run" beside the sheet (`setupHasUnsavedChanges`) ----------------------------
//
// Test drive 2026-09-26: Noah changed Anti Roll Bar (Front) 1.3 → 1.4 and back; the badge cleared
// and the yellow "Save to this run" stayed.

test("an edit put back leaves nothing to save", () => {
  const loaded = loadIntoForm(MI10_BASELINE);
  const surface = sheetValuesFromSnapshot(loaded);
  const once = sheetReport(loaded, { ...surface, anti_roll_bar_front: "f_1_4" });
  assert.equal(setupHasUnsavedChanges(once, loaded), true);
  const back = sheetReport(once, { ...surface, anti_roll_bar_front: "f_1_3" });
  assert.equal(setupHasUnsavedChanges(back, loaded), false);
});

test("against a save, going back to the loaded value is still an edit to save", () => {
  const loaded = loadIntoForm(MI10_BASELINE);
  const surface = sheetValuesFromSnapshot(loaded);
  const saved = sheetReport(loaded, { ...surface, anti_roll_bar_front: "f_1_4" });
  const back = sheetReport(saved, { ...surface, anti_roll_bar_front: "f_1_3" });
  assert.equal(setupHasUnsavedChanges(back, saved), true);
  assert.equal(setupHasUnsavedChanges(saved, saved), false);
});

test("a blank sheet with a box filled has something to save; the tyre alone does not", () => {
  assert.equal(setupHasUnsavedChanges(loadIntoForm({ toe_rear: 3 }), null), true);
  assert.equal(setupHasUnsavedChanges(loadIntoForm({ toe_rear: "" }), null), false);
  const tyre = { tireTypeId: "t1", displayName: "Blue", tireRunNumber: 1, tireAgeKnown: true };
  assert.equal(setupHasUnsavedChanges(loadIntoForm({ tires: tyre }), loadIntoForm({})), false);
});
