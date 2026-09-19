import assert from "node:assert/strict";
import test from "node:test";
import { formatRunTiresOneLine, isSplitTireRun, runTireEndLines } from "./runTireEnds";

const touring = { tireType: { displayName: "Sweep D32" }, tireRunNumber: 3, tireAgeKnown: true };
const buggy = {
  tireType: { displayName: "Cactus Yellow" },
  tireRunNumber: 1,
  tireAgeKnown: true,
  frontTireTypeId: "f1",
  frontTireType: { displayName: "AKA Array Clay" },
  frontTireRunNumber: 2,
  frontTireAgeKnown: false,
  tireFitment: { front: { insert: "Stock", wheel: "Mono", mods: "3 extra holes" } },
};

test("a single-tire run reads exactly as it always has", () => {
  assert.equal(isSplitTireRun(touring), false);
  assert.deepEqual(runTireEndLines(touring), [
    { end: "only", label: null, identity: "Sweep D32 · run 3", fitment: null },
  ]);
  assert.equal(formatRunTiresOneLine(touring), "Sweep D32 · run 3");
  assert.equal(
    formatRunTiresOneLine({ ...touring, tireAgeKnown: false }),
    "Sweep D32 · run 3 (age unknown)"
  );
});

test("a run with nothing logged says nothing", () => {
  assert.deepEqual(runTireEndLines({}), []);
  assert.deepEqual(runTireEndLines(null), []);
  assert.equal(formatRunTiresOneLine({ tireType: null }), null);
});

test("a front/rear run names both ends, front first, each with its own count", () => {
  assert.equal(isSplitTireRun(buggy), true);
  assert.deepEqual(runTireEndLines(buggy), [
    {
      end: "front",
      label: "Front",
      identity: "AKA Array Clay · run 2 (age unknown)",
      fitment: "Stock insert · Mono wheel · 3 extra holes",
    },
    { end: "rear", label: "Rear", identity: "Cactus Yellow · run 1", fitment: null },
  ]);
  assert.equal(
    formatRunTiresOneLine(buggy),
    "F AKA Array Clay · run 2 (age unknown) / R Cactus Yellow · run 1"
  );
  assert.equal(
    formatRunTiresOneLine(buggy, { fitment: true }),
    "F AKA Array Clay · run 2 (age unknown) (Stock insert · Mono wheel · 3 extra holes) / R Cactus Yellow · run 1"
  );
});

test("front/rear is decided by the run's own data — an insert alone is enough", () => {
  const rearOnly = { ...touring, tireFitment: { rear: { insert: "Stock" } } };
  assert.equal(isSplitTireRun(rearOnly), true);
  assert.deepEqual(
    runTireEndLines(rearOnly).map((l) => [l.end, l.identity, l.fitment]),
    [
      ["front", null, null],
      ["rear", "Sweep D32 · run 3", "Stock insert"],
    ]
  );
  // The front has nothing to show, so the one-liner leaves it out rather than printing a dash.
  assert.equal(formatRunTiresOneLine(rearOnly), "R Sweep D32 · run 3");
  // An emptied fitment is not front/rear.
  assert.equal(isSplitTireRun({ ...touring, tireFitment: { rear: { insert: " " } } }), false);
});
