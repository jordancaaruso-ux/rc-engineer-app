import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreBlankForKeys } from "@/lib/setupSheetModels/sheetBlankResolve";

/**
 * The overlap score is what picks WHICH of a chassis's sheets a setup draws on — primary blank or
 * a rebuilt edition — so what it counts is load-bearing: a wrong count draws a driver's values on
 * paper whose boxes don't speak their keys, which looks like a lost setup.
 */

function box(key: string, extra?: Record<string, unknown>) {
  return { key, pageNumber: 1, x: 0.1, y: 0.1, width: 0.1, height: 0.05, style: {}, ...extra };
}

test("counts a key once no matter how many boxes share it", () => {
  // A grouped parameter's printed tick boxes all share one key (DerivedBox.optionValue). Counting
  // each box would let one 10-option row outvote nine ordinary matched boxes.
  const boxes = [
    box("traction", { optionValue: "low" }),
    box("traction", { optionValue: "medium" }),
    box("traction", { optionValue: "high" }),
    box("camber_front"),
  ];
  assert.equal(scoreBlankForKeys(boxes, new Set(["traction", "camber_front"])), 2);
});

test("only keys the setup actually has count", () => {
  const boxes = [box("front_camber"), box("rear_camber"), box("spur")];
  assert.equal(scoreBlankForKeys(boxes, new Set(["spur", "pinion", "ride_height_front"])), 1);
});

test("empty or malformed boxesJson scores zero rather than throwing", () => {
  assert.equal(scoreBlankForKeys(null, new Set(["a"])), 0);
  assert.equal(scoreBlankForKeys([], new Set(["a"])), 0);
  assert.equal(scoreBlankForKeys([{ nonsense: true }, 42, "x"], new Set(["a"])), 0);
});

test("disjoint vocabularies produce a clean separation, not a near-tie", () => {
  // The real case this exists for (measured 2026-08-16): the curated A800RR names Text-style
  // boxes, the rebuilt Urbain edition names human-readable ones, and only spur/pinion overlap.
  const primaryBoxes = [box("text53"), box("text5"), box("text1"), box("spur"), box("pinion")];
  const editionBoxes = [
    box("front_camber"),
    box("rear_camber"),
    box("front_ride_height"),
    box("spur"),
    box("pinion"),
  ];
  const editionSetupKeys = new Set([
    "front_camber",
    "rear_camber",
    "front_ride_height",
    "spur",
    "pinion",
  ]);
  const primaryScore = scoreBlankForKeys(primaryBoxes, editionSetupKeys);
  const editionScore = scoreBlankForKeys(editionBoxes, editionSetupKeys);
  assert.equal(primaryScore, 2);
  assert.equal(editionScore, 5);
  assert.ok(editionScore > primaryScore);
});
