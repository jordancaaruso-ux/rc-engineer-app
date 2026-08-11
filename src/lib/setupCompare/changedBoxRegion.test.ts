import assert from "node:assert/strict";
import { changedBoxRegions, type ChangedSheetBox } from "@/lib/setupCompare/changedBoxRegion";

function box(p: Partial<ChangedSheetBox> & { key: string }): ChangedSheetBox {
  return { pageNumber: 1, x: 0.5, y: 0.5, width: 0.04, height: 0.015, ...p };
}

const inside = (v: number) => v >= 0 && v <= 1;

// --- Nothing changed, nothing to show ----------------------------------------------------------
{
  assert.deepEqual(changedBoxRegions([box({ key: "a" })], []), []);
  assert.deepEqual(changedBoxRegions([], ["a"]), []);
  assert.deepEqual(changedBoxRegions([box({ key: "a" })], ["not_this_one"]), []);
}

// --- The crop leaves far more room on the left, where the caption is printed --------------------
{
  const [region] = changedBoxRegions([box({ key: "a", x: 0.5, y: 0.5 })], ["a"]);
  assert.ok(region);
  const leftRoom = 0.5 - region.crop.x;
  const rightRoom = region.crop.x + region.crop.width - (0.5 + 0.04);
  assert.ok(leftRoom > rightRoom * 2, `caption side should get the room: ${leftRoom} vs ${rightRoom}`);
}

// --- A crop never leaves the page --------------------------------------------------------------
{
  for (const at of [0, 0.02, 0.5, 0.96, 1]) {
    const [region] = changedBoxRegions([box({ key: "a", x: at, y: at })], ["a"]);
    assert.ok(region, `no region at ${at}`);
    assert.ok(inside(region.crop.x) && inside(region.crop.y), `origin off the page at ${at}`);
    assert.ok(region.crop.x + region.crop.width <= 1 + 1e-9, `runs off the right at ${at}`);
    assert.ok(region.crop.y + region.crop.height <= 1 + 1e-9, `runs off the bottom at ${at}`);
  }
}

// --- A box in the top-left corner still gets a full-sized crop, slid inward ---------------------
{
  const [region] = changedBoxRegions([box({ key: "a", x: 0.01, y: 0.01 })], ["a"]);
  assert.equal(region!.crop.x, 0);
  assert.equal(region!.crop.y, 0);
  assert.ok(region!.crop.width >= 0.34 - 1e-9, "a corner box must not get a sliver of a crop");
  assert.ok(region!.crop.height >= 0.16 - 1e-9);
}

// --- Box positions come back relative to the crop, which is what the markup needs ---------------
{
  const [region] = changedBoxRegions([box({ key: "a", x: 0.5, y: 0.5, width: 0.04, height: 0.02 })], ["a"]);
  const b = region!.boxes[0]!;
  // Same place on the page, measured against the crop instead.
  assert.ok(Math.abs((region!.crop.x + b.x * region!.crop.width) - 0.5) < 1e-9);
  assert.ok(Math.abs((region!.crop.y + b.y * region!.crop.height) - 0.5) < 1e-9);
  assert.ok(Math.abs(b.width * region!.crop.width - 0.04) < 1e-9);
  assert.ok(b.x > 0 && b.x < 1, "the box has to be inside its own crop");
}

// --- Changes far apart get a picture each, not one unreadable strip -----------------------------
{
  // The case that sent this back for a second go: two boxes at opposite ends of the Mugen sheet
  // made a crop 364px wide and 97 tall on a phone, in which nothing could be read.
  const regions = changedBoxRegions(
    [box({ key: "a", x: 0.05, y: 0.06 }), box({ key: "b", x: 0.88, y: 0.1 })],
    ["a", "b"]
  );
  assert.equal(regions.length, 2, "two far-apart changes are two pictures");
  for (const r of regions) {
    assert.equal(r.boxes.length, 1);
    assert.ok(r.crop.width < 0.6, `each crop should stay zoomed in, got ${r.crop.width}`);
  }
}

// --- Changes near each other share one picture ---------------------------------------------------
{
  const regions = changedBoxRegions(
    [box({ key: "a", x: 0.4, y: 0.4 }), box({ key: "b", x: 0.45, y: 0.42 })],
    ["a", "b"]
  );
  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.boxes.length, 2);
}

// --- A chain of boxes ends up in one picture, even when the ends do not touch --------------------
{
  const regions = changedBoxRegions(
    [
      box({ key: "a", x: 0.30, y: 0.4 }),
      box({ key: "b", x: 0.44, y: 0.4 }),
      box({ key: "c", x: 0.58, y: 0.4 }),
    ],
    ["a", "b", "c"]
  );
  assert.equal(regions.length, 1, "merging a with b must bring c into reach");
  assert.equal(regions[0]!.boxes.length, 3);
}

// --- Scattered right across a page: one picture of the page beats a wall of small ones ------------
{
  const regions = changedBoxRegions(
    [
      box({ key: "a", x: 0.02, y: 0.03 }),
      box({ key: "b", x: 0.5, y: 0.03 }),
      box({ key: "c", x: 0.95, y: 0.03 }),
      box({ key: "d", x: 0.02, y: 0.9 }),
      box({ key: "e", x: 0.95, y: 0.9 }),
    ],
    ["a", "b", "c", "d", "e"]
  );
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0]!.crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(regions[0]!.boxes.length, 5);
}

// --- Pages in order, and the pictures within a page run top to bottom ----------------------------
{
  const regions = changedBoxRegions(
    [
      box({ key: "p2low", pageNumber: 2, x: 0.4, y: 0.8 }),
      box({ key: "p1a", pageNumber: 1, x: 0.4, y: 0.4 }),
      box({ key: "p2high", pageNumber: 2, x: 0.4, y: 0.1 }),
    ],
    ["p1a", "p2low", "p2high"]
  );
  assert.deepEqual(regions.map((r) => r.pageNumber), [1, 2, 2]);
  assert.deepEqual(regions[1]!.boxes.map((b) => b.key), ["p2high"]);
  assert.deepEqual(regions[2]!.boxes.map((b) => b.key), ["p2low"]);
}

// --- A page with no changed box is not shown at all -----------------------------------------------
{
  const regions = changedBoxRegions(
    [box({ key: "a", pageNumber: 1 }), box({ key: "untouched", pageNumber: 2 })],
    ["a"]
  );
  assert.deepEqual(regions.map((r) => r.pageNumber), [1]);
}

console.log("changedBoxRegion.test.ts ok");
