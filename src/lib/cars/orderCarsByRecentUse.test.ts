import { test } from "node:test";
import assert from "node:assert/strict";
import { lastRunAtMsByCarId, orderCarsByRecentUse } from "./orderCarsByRecentUse";

const JAN = new Date("2026-01-01T00:00:00Z");
const JUN = new Date("2026-06-01T00:00:00Z");
const AUG = new Date("2026-08-01T00:00:00Z");
const AUG_LATER = new Date("2026-08-14T00:00:00Z");

type TestCar = { id: string; createdAt: Date };
const createdAtMs = (c: TestCar) => c.createdAt.getTime();
const ids = (cars: TestCar[]) => cars.map((c) => c.id);

test("the car you actually drive beats the one you added later", () => {
  // The bug this exists for: the A800RR is every run in the app; the shelf car was bought after it.
  const cars: TestCar[] = [
    { id: "shelf", createdAt: JUN },
    { id: "a800rr", createdAt: JAN },
  ];
  const order = orderCarsByRecentUse(cars, new Map([["a800rr", AUG.getTime()]]), createdAtMs);
  assert.deepEqual(ids(order), ["a800rr", "shelf"]);
});

test("a car with no runs still sorts by when it was added", () => {
  const cars: TestCar[] = [
    { id: "old", createdAt: JAN },
    { id: "new", createdAt: JUN },
  ];
  assert.deepEqual(ids(orderCarsByRecentUse(cars, new Map(), createdAtMs)), ["new", "old"]);
});

test("a car added since the last run does NOT displace the driven one", () => {
  // The measured case (founder's rows, 2026-08-15): four never-run cars added after his last
  // A800RR run. Adding is a minute's work, running is a weekend — they don't share an axis.
  const cars: TestCar[] = [
    { id: "justAdded", createdAt: AUG_LATER },
    { id: "driven", createdAt: JAN },
  ];
  const order = orderCarsByRecentUse(cars, new Map([["driven", AUG.getTime()]]), createdAtMs);
  assert.deepEqual(ids(order), ["driven", "justAdded"]);
});

test("one run on the new car puts it top", () => {
  const cars: TestCar[] = [
    { id: "newCar", createdAt: AUG_LATER },
    { id: "driven", createdAt: JAN },
  ];
  const runs = new Map([
    ["driven", AUG.getTime()],
    ["newCar", new Date("2026-08-15T00:00:00Z").getTime()],
  ]);
  assert.deepEqual(ids(orderCarsByRecentUse(cars, runs, createdAtMs)), ["newCar", "driven"]);
});

test("every never-run car sits below every driven one, however old the run", () => {
  const cars: TestCar[] = [
    { id: "shelfA", createdAt: AUG_LATER },
    { id: "shelfB", createdAt: AUG },
    { id: "drivenOnce", createdAt: JAN },
  ];
  const order = orderCarsByRecentUse(cars, new Map([["drivenOnce", JAN.getTime()]]), createdAtMs);
  assert.deepEqual(ids(order), ["drivenOnce", "shelfA", "shelfB"]);
});

test("ties keep the order they came in — no reshuffling between loads", () => {
  const cars: TestCar[] = [
    { id: "a", createdAt: JAN },
    { id: "b", createdAt: JAN },
    { id: "c", createdAt: JAN },
  ];
  assert.deepEqual(ids(orderCarsByRecentUse(cars, new Map(), createdAtMs)), ["a", "b", "c"]);
});

test("the input array is not mutated", () => {
  const cars: TestCar[] = [
    { id: "old", createdAt: JAN },
    { id: "new", createdAt: JUN },
  ];
  orderCarsByRecentUse(cars, new Map(), createdAtMs);
  assert.deepEqual(ids(cars), ["old", "new"]);
});

test("groupBy rows become a car→ms map, dropping orphaned runs", () => {
  const map = lastRunAtMsByCarId([
    { carId: "a800rr", _max: { createdAt: AUG } },
    { carId: null, _max: { createdAt: AUG_LATER } }, // run whose car was deleted
    { carId: "neverRun", _max: { createdAt: null } },
  ]);
  assert.deepEqual([...map.entries()], [["a800rr", AUG.getTime()]]);
});
