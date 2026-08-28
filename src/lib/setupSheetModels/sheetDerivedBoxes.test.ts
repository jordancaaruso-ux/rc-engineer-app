import assert from "node:assert/strict";
import {
  applyDerivedSheetBoxes,
  derivedBoxKeysOnSheet,
  DERIVED_SHEET_BOX_KEYS,
} from "@/lib/setupSheetModels/sheetDerivedBoxes";

const A800RR_SHEET = derivedBoxKeysOnSheet([
  "spring_front",
  "spring_rear",
  "spring_gap_front",
  "spring_gap_rear",
  "srs_arrangement_front",
  "srs_arrangement_rear",
  "lower_arm_extension_front",
  "front_spring_rate_gf_mm",
  "rear_spring_rate_gf_mm",
  "spur",
  "pinion",
  "final_drive_ratio",
]);

/** The sheet's inputs, front only, with a gap that is on a table step. */
function frontInputs(gap: string): Record<string, string> {
  return {
    spring_front: "STD",
    srs_arrangement_front: "II",
    spring_gap_front: gap,
  };
}

// --- Only the boxes the paper prints ----------------------------------------------------------
{
  assert.deepEqual([...A800RR_SHEET].sort(), [...DERIVED_SHEET_BOX_KEYS].sort());

  // Measured against every chassis in the database on 2026-08-26: Mugen MTC3, Schumacher Mi10 and
  // two drivers' own sheets all carry spur and pinion, and NOT ONE carries a final-drive box. The
  // 1.9 in the ratio is the A800RR's own internal ratio, so it must never reach another car.
  const mugenish = derivedBoxKeysOnSheet(["spur", "pinion", "spring_front", "fdr", "spurgear"]);
  assert.equal(mugenish.size, 0, "a sheet with no derived box printed on it gets nothing written");

  const before = { spur: "100", pinion: "42" };
  assert.equal(
    applyDerivedSheetBoxes(before, mugenish),
    before,
    "and the values come back untouched, by identity"
  );
}

// --- Spring rate follows the gap --------------------------------------------------------------
{
  const at3 = applyDerivedSheetBoxes(frontInputs("3"), A800RR_SHEET);
  const at2 = applyDerivedSheetBoxes(frontInputs("2"), A800RR_SHEET);
  assert.equal(at3.front_spring_rate_gf_mm, "61.4");
  assert.notEqual(
    at2.front_spring_rate_gf_mm,
    at3.front_spring_rate_gf_mm,
    "a different gap is a different rate — this is the whole bug"
  );

  // Written the way the store writes it: `Number(n.toFixed(3))`, so no trailing zeros. A sheet
  // edit and a form edit have to leave the same bytes or the change list reports a phantom move.
  assert.equal(/\.\d*0$/.test(String(at3.front_spring_rate_gf_mm)), false);
}

// --- A stale rate sitting in the box is overwritten, not preferred ----------------------------
{
  const stale = { ...frontInputs("3"), front_spring_rate_gf_mm: "73.1" };
  const fixed = applyDerivedSheetBoxes(stale, A800RR_SHEET);
  assert.equal(fixed.front_spring_rate_gf_mm, "61.4");
}

// --- The lower arm extension softens the rate, as a LEVER, not as gap it takes away ------------
// The retired table did `gap − extension`; the sheet's own formula divides by (lever + extension)²
// instead. Asserted here because a reader would reasonably assume the old arithmetic.
{
  const plain = applyDerivedSheetBoxes(frontInputs("3"), A800RR_SHEET);
  const extended = applyDerivedSheetBoxes(
    { ...frontInputs("3"), lower_arm_extension_front: "1" },
    A800RR_SHEET
  );
  const asIfGapWere2 = applyDerivedSheetBoxes(frontInputs("2"), A800RR_SHEET);

  assert.notEqual(extended.front_spring_rate_gf_mm, plain.front_spring_rate_gf_mm, "it must do something");
  assert.notEqual(
    extended.front_spring_rate_gf_mm,
    asIfGapWere2.front_spring_rate_gf_mm,
    "and it must NOT be the same as taking 1 mm off the gap"
  );
  assert.equal(extended.front_spring_rate_gf_mm, "57.3");
  assert.equal(asIfGapWere2.front_spring_rate_gf_mm, "55.1");
}

// --- Inputs that cannot answer CLEAR the box rather than leaving the last answer ---------------
{
  // The gap erased. A rate worked out from a number the driver has just deleted is not a reading.
  const erased = applyDerivedSheetBoxes(
    { spring_front: "STD", srs_arrangement_front: "II", spring_gap_front: "", front_spring_rate_gf_mm: "61.4" },
    A800RR_SHEET
  );
  assert.equal(erased.front_spring_rate_gf_mm, "", "cleared, using the surface's deletion marker");

  // An extension that cancels the lever length divides by zero — the one case the formula itself
  // cannot answer.
  const cancelled = applyDerivedSheetBoxes(
    { ...frontInputs("3"), lower_arm_extension_front: "-28.7", front_spring_rate_gf_mm: "61.4" },
    A800RR_SHEET
  );
  assert.equal(cancelled.front_spring_rate_gf_mm, "");
}

// --- An absurd gap gives an absurd rate, ON PURPOSE ---------------------------------------------
// The retired table refused anything outside 0–5 mm, which read as the app failing. The sheet's
// script has no bound, so neither do we: a driver who types 99 into the gap sees what Acrobat would
// show them, sitting next to the 99 they just typed. That is a clearer signal than a blank box.
{
  const absurd = applyDerivedSheetBoxes(frontInputs("99"), A800RR_SHEET);
  assert.ok(Number(absurd.front_spring_rate_gf_mm) > 1e6);

  // But a gap just past the old table's edge is an ORDINARY answer now, not a refusal.
  // `frontInputs` is SRS II, so 5.4 mm of gap reaches the formula as 1.4.
  const justPast = applyDerivedSheetBoxes(frontInputs("5.4"), A800RR_SHEET);
  assert.equal(justPast.front_spring_rate_gf_mm, "79.7");
}

// --- Final drive follows spur and pinion ------------------------------------------------------
{
  const at42 = applyDerivedSheetBoxes({ spur: "100", pinion: "42" }, A800RR_SHEET);
  assert.equal(at42.final_drive_ratio, "4.5238");

  const at40 = applyDerivedSheetBoxes({ spur: "100", pinion: "40" }, A800RR_SHEET);
  assert.equal(at40.final_drive_ratio, "4.75");

  // A pinion of zero is not a ratio of infinity.
  const zero = applyDerivedSheetBoxes(
    { spur: "100", pinion: "0", final_drive_ratio: "4.5238" },
    A800RR_SHEET
  );
  assert.equal(zero.final_drive_ratio, "");
}

// --- Nothing moved means the SAME object, so the surface does not re-render or re-save ---------
{
  const settled = applyDerivedSheetBoxes(frontInputs("3"), A800RR_SHEET);
  assert.equal(applyDerivedSheetBoxes(settled, A800RR_SHEET), settled);

  // A box that has nothing to do with the formulas passes straight through.
  const withNote = { ...settled, comments: "loose on power" };
  assert.equal(applyDerivedSheetBoxes(withNote, A800RR_SHEET), withNote);
}

// --- One side never answers for the other -----------------------------------------------------
{
  const frontOnly = applyDerivedSheetBoxes(frontInputs("3"), A800RR_SHEET);
  assert.equal(frontOnly.front_spring_rate_gf_mm, "61.4");
  // ABSENT, not blank. A deletion marker is for a value that was there and is now gone; minting
  // one for a box nobody ever filled would put an instruction to delete into every payload, for
  // every derived box on the sheet, forever.
  assert.equal("rear_spring_rate_gf_mm" in frontOnly, false);
  assert.equal("final_drive_ratio" in frontOnly, false);
}

console.log("sheetDerivedBoxes.test.ts ok");
