import test from "node:test";
import assert from "node:assert/strict";
import {
  chipOnHandLoggedRun,
  declinedKey,
  formatChipMovedSetting,
  livePendingChipQuestion,
  parseChipMovedSetting,
} from "./transponderMoved";

const cars = ["car-a", "car-b"];

test("an unpaired chip on a hand-logged run is paired", () => {
  assert.equal(chipOnHandLoggedRun({ chip: "1234567", runCarId: "car-a", map: {}, userCarIds: cars, declined: [] }), "pair");
});

test("a chip paired with a gone car is re-paired", () => {
  assert.equal(
    chipOnHandLoggedRun({ chip: "1234567", runCarId: "car-a", map: { "1234567": "car-gone" }, userCarIds: cars, declined: [] }),
    "pair",
  );
});

test("the hand-logged car matches the pairing: nothing to learn", () => {
  assert.equal(
    chipOnHandLoggedRun({ chip: "1234567", runCarId: "car-a", map: { "1234567": "car-a" }, userCarIds: cars, declined: [] }),
    null,
  );
});

test("the hand-logged car differs from the pairing: ask", () => {
  assert.equal(
    chipOnHandLoggedRun({ chip: "1234567", runCarId: "car-b", map: { "1234567": "car-a" }, userCarIds: cars, declined: [] }),
    "ask",
  );
});

test("already answered 'still in' for that chip and car: never asked again", () => {
  assert.equal(
    chipOnHandLoggedRun({
      chip: "1234567",
      runCarId: "car-b",
      map: { "1234567": "car-a" },
      userCarIds: cars,
      declined: [declinedKey("1234567", "car-b")],
    }),
    null,
  );
});

test("no chip, or no car on the run: nothing", () => {
  assert.equal(chipOnHandLoggedRun({ chip: null, runCarId: "car-a", map: {}, userCarIds: cars, declined: [] }), null);
  assert.equal(chipOnHandLoggedRun({ chip: "1234567", runCarId: null, map: {}, userCarIds: cars, declined: [] }), null);
});

test("the setting round-trips", () => {
  const state = { pending: { chip: "1234567", carId: "car-b" }, declined: ["7654321:car-a"] };
  assert.deepEqual(parseChipMovedSetting(formatChipMovedSetting(state)), state);
  assert.equal(formatChipMovedSetting({ pending: null, declined: [] }), null);
  assert.deepEqual(parseChipMovedSetting("not json"), { pending: null, declined: [] });
});

test("a pending question goes quiet once the pairing already says the new car", () => {
  const state = { pending: { chip: "1234567", carId: "car-b" }, declined: [] };
  assert.deepEqual(livePendingChipQuestion({ state, map: { "1234567": "car-a" }, userCarIds: cars }), {
    chip: "1234567",
    carId: "car-b",
    fromCarId: "car-a",
  });
  assert.equal(livePendingChipQuestion({ state, map: { "1234567": "car-b" }, userCarIds: cars }), null);
  assert.equal(livePendingChipQuestion({ state, map: { "1234567": "car-a" }, userCarIds: ["car-a"] }), null);
});
