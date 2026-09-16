import assert from "node:assert/strict";
import { changedBoxCrops, type ChangedSheetBox } from "@/lib/setupCompare/changedBoxRegion";

function box(p: Partial<ChangedSheetBox> & { key: string }): ChangedSheetBox {
  return { pageNumber: 1, x: 0.5, y: 0.5, width: 0.04, height: 0.015, ...p };
}

const inside = (v: number) => v >= 0 && v <= 1;

// --- Nothing changed, nothing to show ----------------------------------------------------------
{
  assert.deepEqual(changedBoxCrops([box({ key: "a" })], []), []);
  assert.deepEqual(changedBoxCrops([], ["a"]), []);
  assert.deepEqual(changedBoxCrops([box({ key: "a" })], ["not_this_one"]), []);
}

// --- One crop per changed box, in the order asked for -------------------------------------------
{
  const crops = changedBoxCrops(
    [box({ key: "a", x: 0.4 }), box({ key: "b", x: 0.2 }), box({ key: "c", pageNumber: 2 })],
    ["c", "a", "b"]
  );
  assert.deepEqual(crops.map((c) => c.key), ["c", "a", "b"]);
  assert.deepEqual(crops.map((c) => c.pageNumber), [2, 1, 1]);
}

// --- Wide enough to carry the caption, never so wide it is the page ----------------------------
// A setup sheet prints a box's caption BESIDE it and a different parameter above and below, so the
// crop is deliberately lopsided: room across for the words, little down.
{
  const [c] = changedBoxCrops([box({ key: "a", x: 0.5, y: 0.5 })], ["a"]);
  assert.ok(c);
  assert.ok(c.crop.width >= 0.25, `too tight to reach the caption: ${c.crop.width}`);
  assert.ok(c.crop.width <= 0.45, `too much page across: ${c.crop.width}`);
  assert.ok(c.crop.height <= 0.1, `too much page down: ${c.crop.height}`);
  assert.ok(c.crop.width > c.crop.height * 2, "the crop has to be wider than it is tall");
}

// --- A crop never leaves the page --------------------------------------------------------------
{
  for (const at of [0, 0.02, 0.5, 0.96, 1]) {
    const [c] = changedBoxCrops([box({ key: "a", x: at, y: at })], ["a"]);
    assert.ok(c, `no crop at ${at}`);
    assert.ok(inside(c.crop.x) && inside(c.crop.y), `origin off the page at ${at}`);
    assert.ok(c.crop.x + c.crop.width <= 1 + 1e-9, `runs off the right at ${at}`);
    assert.ok(c.crop.y + c.crop.height <= 1 + 1e-9, `runs off the bottom at ${at}`);
  }
}

// --- A tick-box gets a minimum crop, so it does not read as a broken image ----------------------
{
  const [c] = changedBoxCrops([box({ key: "a", x: 0.5, y: 0.5, width: 0.004, height: 0.004 })], ["a"]);
  assert.ok(c!.crop.width >= 0.1 - 1e-9, "a tiny box must not get a sliver of a crop");
  assert.ok(c!.crop.height >= 0.03 - 1e-9);
}

// --- A box in the top-left corner keeps its full crop, slid inward ------------------------------
{
  const [c] = changedBoxCrops([box({ key: "a", x: 0.001, y: 0.001 })], ["a"]);
  assert.equal(c!.crop.x, 0);
  assert.equal(c!.crop.y, 0);
  assert.ok(c!.box.x >= 0 && c!.box.x + c!.box.width <= 1, "the box has to be inside its own crop");
}

// --- Box position comes back relative to the crop, which is what the markup needs ---------------
{
  const [c] = changedBoxCrops([box({ key: "a", x: 0.5, y: 0.5, width: 0.04, height: 0.02 })], ["a"]);
  assert.ok(Math.abs((c!.crop.x + c!.box.x * c!.crop.width) - 0.5) < 1e-9);
  assert.ok(Math.abs((c!.crop.y + c!.box.y * c!.crop.height) - 0.5) < 1e-9);
  assert.ok(Math.abs(c!.box.width * c!.crop.width - 0.04) < 1e-9);
  assert.ok(c!.box.x > 0 && c!.box.x < 1, "the box has to be inside its own crop");
}

console.log("changedBoxRegion.test.ts ok");
