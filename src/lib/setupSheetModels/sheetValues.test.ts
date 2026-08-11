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
    top_deck_screws: ["a", "b"],
    notes: null,
  };
  assert.deepEqual(sheetValuesFromSnapshot(snapshot), { text2: "4.5", text9: "3" });
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

// --- Clearing a box removes the key, rather than storing a blank over it ---------------------
{
  const merged = mergeSheetValuesIntoSnapshot({ text2: "4.5", text3: "1" }, { text2: "", text3: "1" });
  assert.deepEqual(merged, { text3: "1" });
  assert.equal("text2" in merged, false, "a cleared box must not keep its old value");
}

// --- The previous snapshot is never mutated --------------------------------------------------
{
  const previous: SetupSnapshotData = { text2: "4.5" };
  mergeSheetValuesIntoSnapshot(previous, { text2: "5.0", text3: "" });
  assert.deepEqual(previous, { text2: "4.5" });
}

console.log("sheetValues.test.ts ok");
