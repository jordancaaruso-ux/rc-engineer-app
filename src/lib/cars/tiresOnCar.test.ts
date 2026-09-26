import test from "node:test";
import assert from "node:assert/strict";
import { tiresOnCar, type TireRunRow } from "./tiresOnCar";

function run(input: Partial<TireRunRow>): TireRunRow {
  return {
    tireTypeId: null,
    tireRunNumber: 1,
    tireType: null,
    frontTireTypeId: null,
    frontTireRunNumber: null,
    frontTireType: null,
    tireSet: null,
    ...input,
  };
}

const HOLE_SHOT = { id: "hole-shot", displayName: "Pro-Line Hole Shot S4" };
const BLOCKADE = { id: "blockade", displayName: "Pro-Line Blockade M4" };

test("the same compound front and rear is one run on it, not two (test drive 2026-09-26)", () => {
  const tires = tiresOnCar([
    run({
      tireTypeId: HOLE_SHOT.id,
      tireType: { displayName: HOLE_SHOT.displayName },
      tireRunNumber: 1,
      frontTireTypeId: HOLE_SHOT.id,
      frontTireType: { displayName: HOLE_SHOT.displayName },
      frontTireRunNumber: 1,
    }),
  ]);
  assert.deepEqual(tires, [{ id: HOLE_SHOT.id, label: HOLE_SHOT.displayName, runCount: 1, furthestRun: 1 }]);
});

test("how far a compound was taken still reads both ends", () => {
  const [tire] = tiresOnCar([
    run({
      tireTypeId: HOLE_SHOT.id,
      tireType: { displayName: HOLE_SHOT.displayName },
      tireRunNumber: 2,
      frontTireTypeId: HOLE_SHOT.id,
      frontTireType: { displayName: HOLE_SHOT.displayName },
      frontTireRunNumber: 5,
    }),
  ]);
  assert.equal(tire?.runCount, 1);
  assert.equal(tire?.furthestRun, 5);
});

test("different compounds front and rear each count the run", () => {
  const tires = tiresOnCar([
    run({
      tireTypeId: HOLE_SHOT.id,
      tireType: { displayName: HOLE_SHOT.displayName },
      tireRunNumber: 3,
      frontTireTypeId: BLOCKADE.id,
      frontTireType: { displayName: BLOCKADE.displayName },
      frontTireRunNumber: 2,
    }),
    run({ tireTypeId: HOLE_SHOT.id, tireType: { displayName: HOLE_SHOT.displayName }, tireRunNumber: 4 }),
  ]);
  assert.deepEqual(
    tires.map((t) => [t.label, t.runCount, t.furthestRun]),
    [
      [BLOCKADE.displayName, 1, 2],
      [HOLE_SHOT.displayName, 2, 4],
    ]
  );
});

test("a compound known only from the run's tire set still counts", () => {
  const tires = tiresOnCar([
    run({
      tireRunNumber: 6,
      tireSet: { tireTypeId: HOLE_SHOT.id, tireType: { displayName: HOLE_SHOT.displayName } },
    }),
  ]);
  assert.deepEqual(tires, [{ id: HOLE_SHOT.id, label: HOLE_SHOT.displayName, runCount: 1, furthestRun: 6 }]);
});

test("a run with no compound adds nothing", () => {
  assert.deepEqual(tiresOnCar([run({})]), []);
});
