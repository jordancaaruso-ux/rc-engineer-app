import assert from "node:assert/strict";
import test from "node:test";

import {
  findPendingCell,
  pendingGridMatchesShape,
  pendingGridSourceKeys,
  reshapePendingGrid,
} from "@/lib/setupSheetModels/pendingBoxGrid";

test("the next empty cell walks across a position's options before the next position", () => {
  const grid = [
    ["a#0", null, null],
    [null, null, null],
  ];
  assert.deepEqual(
    findPendingCell(grid, (k) => k === null),
    { row: 0, col: 1 }
  );
  const afterFrontRow = [
    ["a#0", "b#0", "c#0"],
    [null, null, null],
  ];
  assert.deepEqual(
    findPendingCell(afterFrontRow, (k) => k === null),
    { row: 1, col: 0 }
  );
});

test("a filled grid reports no empty cell", () => {
  assert.equal(
    findPendingCell([["a#0"], ["b#0"]], (k) => k === null),
    null
  );
});

test("a box already placed is found by its own coordinates, so re-clicking clears the right cell", () => {
  const grid = [
    ["a#0", "b#0"],
    ["c#0", "d#0"],
  ];
  assert.deepEqual(
    findPendingCell(grid, (k) => k === "d#0"),
    { row: 1, col: 1 }
  );
});

test("widening a row for a grouped kind keeps column 0 where it was", () => {
  const grid = [["a#0"], ["b#0"]];
  assert.deepEqual(reshapePendingGrid(grid, [3, 3]), [
    ["a#0", null, null],
    ["b#0", null, null],
  ]);
});

test("rows can be ragged — front with 3 options, rear with 4", () => {
  const grid = [
    ["a#0", "b#0", "c#0"],
    ["d#0", "e#0", "f#0", "g#0"],
  ];
  assert.deepEqual(reshapePendingGrid(grid, [3, 4]), grid);
  // Narrowing drops the tail rather than shifting it into the next row.
  assert.deepEqual(reshapePendingGrid(grid, [2, 2]), [
    ["a#0", "b#0"],
    ["d#0", "e#0"],
  ]);
});

test("changing the number of positions adds or removes whole rows", () => {
  assert.deepEqual(reshapePendingGrid([["a#0", "b#0"]], [2, 2, 2, 2]), [
    ["a#0", "b#0"],
    [null, null],
    [null, null],
    [null, null],
  ]);
});

test("shape matching ignores contents, so an unchanged shape can skip a state update", () => {
  assert.equal(pendingGridMatchesShape([["a#0", null], [null, null]], [2, 2]), true);
  assert.equal(pendingGridMatchesShape([["a#0", null]], [2, 2]), false);
  assert.equal(pendingGridMatchesShape([["a#0", null], [null]], [2, 2]), false);
  assert.equal(pendingGridMatchesShape([], []), true);
});

test("source keys come out row-major with the holes dropped", () => {
  assert.deepEqual(
    pendingGridSourceKeys([
      ["a#0", null, "c#0"],
      [null, "e#0"],
    ]),
    ["a#0", "c#0", "e#0"]
  );
});
