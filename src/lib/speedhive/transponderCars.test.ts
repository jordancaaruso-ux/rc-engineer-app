import test from "node:test";
import assert from "node:assert/strict";
import { chipToPairWithNamedCar } from "./transponderCars";

test("one chip, not yet paired: pair it", () => {
  assert.equal(
    chipToPairWithNamedCar({ chips: ["1234567", null, "1234567"], map: {}, userCarIds: ["car-a"] }),
    "1234567",
  );
});

test("sessions found without a chip teach nothing", () => {
  assert.equal(chipToPairWithNamedCar({ chips: [null, undefined], map: {}, userCarIds: ["car-a"] }), null);
});

test("two chips under one answer could be two cars: pair neither", () => {
  assert.equal(
    chipToPairWithNamedCar({ chips: ["1234567", "7654321"], map: {}, userCarIds: ["car-a"] }),
    null,
  );
});

test("a chip already paired with a car the driver owns is left alone", () => {
  assert.equal(
    chipToPairWithNamedCar({ chips: ["1234567"], map: { "1234567": "car-b" }, userCarIds: ["car-a", "car-b"] }),
    null,
  );
});

test("a chip paired with a car that is gone is re-paired", () => {
  assert.equal(
    chipToPairWithNamedCar({ chips: ["1234567"], map: { "1234567": "car-gone" }, userCarIds: ["car-a"] }),
    "1234567",
  );
});
