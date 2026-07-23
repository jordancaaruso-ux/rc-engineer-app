/**
 * Run: `npx tsx src/lib/runs/tireSetChange.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeTireIndicatorsByRunId,
  formatTireIndicatorTitle,
} from "@/lib/runs/tireSetChange";

const set = (id: string, label: string) => ({ id, label });

test("every run with a logged set gets an indicator; swaps are flagged changed", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r3", carId: "c1", tireSet: set("s2", "Set 2"), tireRunNumber: 1 }, // newest
    { id: "r2", carId: "c1", tireSet: set("s1", "Set 1"), tireRunNumber: 4 },
    { id: "r1", carId: "c1", tireSet: set("s1", "Set 1"), tireRunNumber: 3 }, // oldest
  ]);
  assert.equal(indicators.size, 3);
  assert.deepEqual(indicators.get("r3"), {
    setLabel: "Set 2",
    runNumber: 1,
    changed: true,
    previousSetLabel: "Set 1",
  });
  assert.deepEqual(indicators.get("r2"), {
    setLabel: "Set 1",
    runNumber: 4,
    changed: false,
    previousSetLabel: null,
  });
  // First run on the car: shown, but no baseline to call it a change.
  assert.equal(indicators.get("r1")?.changed, false);
});

test("a physical mark becomes the set's identity; unmarked sets keep the compound label", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r2", carId: "c1", tireSet: { id: "s2", label: "Soft", mark: "7" }, tireRunNumber: 4 },
    { id: "r1", carId: "c1", tireSet: { id: "s1", label: "Soft" }, tireRunNumber: 3 },
  ]);
  assert.equal(indicators.get("r2")?.setLabel, "Marked 7");
  assert.equal(indicators.get("r2")?.changed, true);
  assert.equal(indicators.get("r2")?.previousSetLabel, "Soft");
  assert.equal(indicators.get("r1")?.setLabel, "Soft");
});

test("runs without a tire set get no indicator and don't break the chain", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r4", carId: "c1", tireSet: set("s2", "Set 2"), tireRunNumber: 1 }, // vs r2's s1 → changed
    { id: "r3", carId: "c1", tireSet: null },
    { id: "r2", carId: "c1", tireSet: set("s1", "Set 1"), tireRunNumber: 2 },
    { id: "r1", carId: "c1" }, // tireSet omitted entirely
  ]);
  assert.deepEqual([...indicators.keys()].sort(), ["r2", "r4"]);
  assert.equal(indicators.get("r4")?.changed, true);
  assert.equal(indicators.get("r4")?.previousSetLabel, "Set 1");
});

test("cars are tracked independently; null carId runs are ignored", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "b2", carId: "c2", tireSet: set("s9", "Set 9"), tireRunNumber: 2 },
    { id: "a2", carId: "c1", tireSet: set("s2", "Set 2"), tireRunNumber: 1 },
    { id: "x1", carId: null, tireSet: set("s5", "Set 5") },
    { id: "b1", carId: "c2", tireSet: set("s9", "Set 9"), tireRunNumber: 1 },
    { id: "a1", carId: "c1", tireSet: set("s1", "Set 1"), tireRunNumber: 6 },
  ]);
  assert.equal(indicators.has("x1"), false);
  assert.equal(indicators.get("a2")?.changed, true); // c1: s1 → s2
  assert.equal(indicators.get("b2")?.changed, false); // c2 stayed on s9
});

test("invalid or missing tireRunNumber → null runNumber", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r2", carId: "c1", tireSet: set("s1", "Set 1"), tireRunNumber: 0 },
    { id: "r1", carId: "c1", tireSet: set("s1", "Set 1") },
  ]);
  assert.equal(indicators.get("r1")?.runNumber, null);
  assert.equal(indicators.get("r2")?.runNumber, null);
});

test("back-and-forth swaps flag every switch", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r3", carId: "c1", tireSet: set("s1", "Set 1"), tireRunNumber: 2 },
    { id: "r2", carId: "c1", tireSet: set("s2", "Set 2"), tireRunNumber: 1 },
    { id: "r1", carId: "c1", tireSet: set("s1", "Set 1"), tireRunNumber: 1 },
  ]);
  assert.equal(indicators.get("r2")?.changed, true);
  assert.equal(indicators.get("r3")?.changed, true);
});

test("formatTireIndicatorTitle: changed vs steady, new-set callout", () => {
  assert.equal(
    formatTireIndicatorTitle({
      setLabel: "Set 2",
      runNumber: 1,
      changed: true,
      previousSetLabel: "Set 1",
    }),
    "Tire set changed · Set 1 → Set 2 · run 1 (new)"
  );
  assert.equal(
    formatTireIndicatorTitle({
      setLabel: "Set 2",
      runNumber: 3,
      changed: false,
      previousSetLabel: null,
    }),
    "Set 2 · run 3"
  );
  assert.equal(
    formatTireIndicatorTitle({
      setLabel: "Set 2",
      runNumber: null,
      changed: false,
      previousSetLabel: null,
    }),
    "Set 2"
  );
});
