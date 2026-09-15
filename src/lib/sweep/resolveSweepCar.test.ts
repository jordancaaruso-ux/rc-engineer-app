import test from "node:test";
import assert from "node:assert/strict";
import { resolveSweepCar } from "./resolveSweepCar";

const at = (hhmm: string) => new Date(`2026-09-19T${hhmm}:00.000Z`);

test("the nearest earlier run today at the track wins", () => {
  const r = resolveSweepCar({
    instant: at("12:00"),
    dayRunsAtTrack: [
      { carId: "car-a", instant: at("09:00") },
      { carId: "car-b", instant: at("11:00") },
      { carId: "car-a", instant: at("13:00") },
    ],
    chipCarId: "car-c",
    userCarIds: ["car-a", "car-b", "car-c"],
  });
  assert.deepEqual(r, { carId: "car-b", source: "earlier_run" });
});

test("no earlier run: the chip's bound car is used", () => {
  const r = resolveSweepCar({
    instant: at("09:00"),
    dayRunsAtTrack: [{ carId: "car-b", instant: at("13:00") }],
    chipCarId: "car-c",
    userCarIds: ["car-b", "car-c"],
  });
  assert.deepEqual(r, { carId: "car-c", source: "chip" });
});

test("a chip bound to a car the driver no longer owns is ignored", () => {
  const r = resolveSweepCar({
    instant: at("09:00"),
    dayRunsAtTrack: [],
    chipCarId: "car-gone",
    userCarIds: ["car-a", "car-b"],
  });
  assert.equal(r, null);
});

test("every run today at the track in one car: that car, even for an earlier session", () => {
  const r = resolveSweepCar({
    instant: at("08:00"),
    dayRunsAtTrack: [
      { carId: "car-a", instant: at("10:00") },
      { carId: "car-a", instant: at("12:00") },
    ],
    chipCarId: null,
    userCarIds: ["car-a", "car-b"],
  });
  assert.deepEqual(r, { carId: "car-a", source: "only_today" });
});

test("two cars today and no earlier run: no decision", () => {
  const r = resolveSweepCar({
    instant: at("08:00"),
    dayRunsAtTrack: [
      { carId: "car-a", instant: at("10:00") },
      { carId: "car-b", instant: at("12:00") },
    ],
    chipCarId: null,
    userCarIds: ["car-a", "car-b"],
  });
  assert.equal(r, null);
});

test("the driver's only car is a fact, not a guess", () => {
  const r = resolveSweepCar({
    instant: at("08:00"),
    dayRunsAtTrack: [],
    chipCarId: null,
    userCarIds: ["car-solo"],
  });
  assert.deepEqual(r, { carId: "car-solo", source: "only_car" });
});

test("several cars, nothing today, no chip: the app must ask", () => {
  const r = resolveSweepCar({
    instant: at("08:00"),
    dayRunsAtTrack: [],
    chipCarId: null,
    userCarIds: ["car-a", "car-b"],
  });
  assert.equal(r, null);
});
