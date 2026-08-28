import assert from "node:assert/strict";
import type { SetupSnapshotData } from "@/lib/runSetup";
import {
  mergeSheetValuesIntoSnapshot,
  sheetValuesFromSnapshot,
  withoutEmptySheetValues,
} from "@/lib/setupSheetModels/sheetValues";

// --- A box opened and left blank is not a value ---------------------------------------------
{
  const kept = withoutEmptySheetValues({ text2: "4.5", text3: "", text4: "   ", text5: "0" });
  assert.deepEqual(kept, { text2: "4.5", text5: "0" });
  assert.equal("text5" in kept, true, "zero is a value a driver typed on purpose");
}

// --- Seeding the sheet takes only what can be drawn in a box --------------------------------
{
  const snapshot: SetupSnapshotData = {
    text2: "4.5",
    text9: 3,
    tires: { tireTypeId: "abc", displayName: "Sorex 32R" },
    // A grouped row's ticked options DO seed (the A800RR's top-deck row is real boxes on the
    // paper); the run context — tires, additive — still never crosses.
    top_deck_screws: ["a", "b"],
    notes: null,
  };
  assert.deepEqual(sheetValuesFromSnapshot(snapshot), {
    text2: "4.5",
    text9: "3",
    top_deck_screws: "a, b",
  });
}

// --- Folding the sheet back leaves everything it never mentioned alone -----------------------
{
  const previous: SetupSnapshotData = {
    text2: "4.5",
    tires: { tireTypeId: "abc" },
    additive: "Verita",
  };
  const merged = mergeSheetValuesIntoSnapshot(previous, { text2: "5.0", text3: "1" });
  assert.deepEqual(merged, {
    text2: "5.0",
    text3: "1",
    tires: { tireTypeId: "abc" },
    additive: "Verita",
  });
}

// --- Clearing a box keeps the key holding "", the marker that says "made blank on purpose" ---
//
// It used to delete the key. That reads as "the driver said nothing about this box" to the
// log-run save, which merges onto a baseline snapshot — so the old value was written straight
// back into the new run and reappeared next time out (reported and filmed 2026-08-25).
{
  const merged = mergeSheetValuesIntoSnapshot({ text2: "4.5", text3: "1" }, { text2: "", text3: "1" });
  assert.deepEqual(merged, { text2: "", text3: "1" });
  assert.equal("text2" in merged, true, "a cleared box must SAY it was cleared, not go quiet");
  assert.equal(merged.text2, "", "and it says so by holding the empty-string marker");
}

// --- A box cleared to whitespace is cleared, not set to spaces -------------------------------
{
  const merged = mergeSheetValuesIntoSnapshot({ text2: "4.5" }, { text2: "   " });
  assert.equal(merged.text2, "");
}

// --- Clearing a box the setup never had is still a marker, and harmless ----------------------
{
  const merged = mergeSheetValuesIntoSnapshot({ text3: "1" }, { text2: "" });
  assert.deepEqual(merged, { text3: "1", text2: "" });
}

// --- The previous snapshot is never mutated --------------------------------------------------
{
  const previous: SetupSnapshotData = { text2: "4.5" };
  mergeSheetValuesIntoSnapshot(previous, { text2: "5.0", text3: "" });
  assert.deepEqual(previous, { text2: "4.5" });
}

console.log("sheetValues.test.ts ok");
