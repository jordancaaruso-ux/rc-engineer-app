/**
 * Run: `npx tsx src/lib/runs/tireSetChange.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeTireIndicatorsByRunId,
  formatTireIdentityLine,
  formatTireIndicatorTitle,
} from "@/lib/runs/tireSetChange";

const tt = (displayName: string) => ({ id: `tt-${displayName}`, displayName });

test("every run with a logged compound gets an indicator; new rubber is flagged changed", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r3", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s2", tireRunNumber: 1 }, // newest
    { id: "r2", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1", tireRunNumber: 4 },
    { id: "r1", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1", tireRunNumber: 3 }, // oldest
  ]);
  assert.equal(indicators.size, 3);
  assert.deepEqual(indicators.get("r3"), {
    tireLabel: "Sweep D32",
    runNumber: 1,
    ageKnown: true,
    changed: true,
    previousTireLabel: "Sweep D32",
  });
  assert.deepEqual(indicators.get("r2"), {
    tireLabel: "Sweep D32",
    runNumber: 4,
    ageKnown: true,
    changed: false,
    previousTireLabel: null,
  });
  // First run on the car: shown, but no baseline to call it a change.
  assert.equal(indicators.get("r1")?.changed, false);
});

test("same stint across a compound rename is not a change; a new stint is", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r2", carId: "c1", tireType: tt("Volante V5R"), tireStintId: "s2", tireRunNumber: 1 },
    { id: "r1", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1", tireRunNumber: 3 },
  ]);
  assert.equal(indicators.get("r2")?.changed, true);
  assert.equal(indicators.get("r2")?.previousTireLabel, "Sweep D32");
  assert.equal(indicators.get("r1")?.tireLabel, "Sweep D32");
});

test("runs without a compound get no indicator and don't break the chain", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r4", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s2", tireRunNumber: 1 },
    { id: "r3", carId: "c1", tireType: null },
    { id: "r2", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1", tireRunNumber: 2 },
    { id: "r1", carId: "c1" }, // tireType omitted entirely
  ]);
  assert.deepEqual([...indicators.keys()].sort(), ["r2", "r4"]);
  assert.equal(indicators.get("r4")?.changed, true);
  assert.equal(indicators.get("r4")?.previousTireLabel, "Sweep D32");
});

test("legacy runs with no stint id are treated as continuous, not as a change", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r2", carId: "c1", tireType: tt("Sweep D32"), tireRunNumber: 4 },
    { id: "r1", carId: "c1", tireType: tt("Sweep D32"), tireRunNumber: 3 },
  ]);
  assert.equal(indicators.get("r2")?.changed, false);
});

test("cars are tracked independently; null carId runs are ignored", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "b2", carId: "c2", tireType: tt("Sweep D32"), tireStintId: "s9", tireRunNumber: 2 },
    { id: "a2", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s2", tireRunNumber: 1 },
    { id: "x1", carId: null, tireType: tt("Sweep D32"), tireStintId: "s5" },
    { id: "b1", carId: "c2", tireType: tt("Sweep D32"), tireStintId: "s9", tireRunNumber: 1 },
    { id: "a1", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1", tireRunNumber: 6 },
  ]);
  assert.equal(indicators.has("x1"), false);
  assert.equal(indicators.get("a2")?.changed, true); // c1: s1 → s2
  assert.equal(indicators.get("b2")?.changed, false); // c2 stayed on s9
});

test("invalid or missing tireRunNumber → null runNumber", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r2", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1", tireRunNumber: 0 },
    { id: "r1", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1" },
  ]);
  assert.equal(indicators.get("r1")?.runNumber, null);
  assert.equal(indicators.get("r2")?.runNumber, null);
});

test("unknown tire age is carried onto the indicator", () => {
  const indicators = computeTireIndicatorsByRunId([
    {
      id: "r1",
      carId: "c1",
      tireType: tt("Sweep D32"),
      tireStintId: "s1",
      tireRunNumber: 2,
      tireAgeKnown: false,
    },
  ]);
  assert.equal(indicators.get("r1")?.ageKnown, false);
});

test("back-and-forth swaps flag every switch", () => {
  const indicators = computeTireIndicatorsByRunId([
    { id: "r3", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1", tireRunNumber: 2 },
    { id: "r2", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s2", tireRunNumber: 1 },
    { id: "r1", carId: "c1", tireType: tt("Sweep D32"), tireStintId: "s1", tireRunNumber: 1 },
  ]);
  assert.equal(indicators.get("r2")?.changed, true);
  assert.equal(indicators.get("r3")?.changed, true);
});

test("formatTireIndicatorTitle: changed vs steady, new + unknown-age callouts", () => {
  assert.equal(
    formatTireIndicatorTitle({
      tireLabel: "Volante V5R",
      runNumber: 1,
      ageKnown: true,
      changed: true,
      previousTireLabel: "Sweep D32",
    }),
    "Tires changed · Sweep D32 → Volante V5R · run 1 (new)"
  );
  assert.equal(
    formatTireIndicatorTitle({
      tireLabel: "Sweep D32",
      runNumber: 3,
      ageKnown: true,
      changed: false,
      previousTireLabel: null,
    }),
    "Sweep D32 · run 3"
  );
  assert.equal(
    formatTireIndicatorTitle({
      tireLabel: "Sweep D32",
      runNumber: 2,
      ageKnown: false,
      changed: false,
      previousTireLabel: null,
    }),
    "Sweep D32 · run 2 (age unknown)"
  );
  assert.equal(
    formatTireIndicatorTitle({
      tireLabel: "Sweep D32",
      runNumber: null,
      ageKnown: true,
      changed: false,
      previousTireLabel: null,
    }),
    "Sweep D32"
  );
});

test("formatTireIdentityLine: compound + wear, never the changed-from prefix", () => {
  // Same wear callouts as the tooltip...
  assert.equal(
    formatTireIdentityLine({
      tireLabel: "Sweep D32",
      runNumber: 3,
      ageKnown: true,
      changed: false,
      previousTireLabel: null,
    }),
    "Sweep D32 · run 3"
  );
  assert.equal(
    formatTireIdentityLine({
      tireLabel: "Sweep D32",
      runNumber: 1,
      ageKnown: true,
      changed: false,
      previousTireLabel: null,
    }),
    "Sweep D32 · run 1 (new)"
  );
  assert.equal(
    formatTireIdentityLine({
      tireLabel: "Sweep D32",
      runNumber: 2,
      ageKnown: false,
      changed: false,
      previousTireLabel: null,
    }),
    "Sweep D32 · run 2 (age unknown)"
  );
  assert.equal(
    formatTireIdentityLine({
      tireLabel: "Sweep D32",
      runNumber: null,
      ageKnown: false,
      changed: false,
      previousTireLabel: null,
    }),
    "Sweep D32 · age unknown"
  );
  // ...but a swap says only what's on the car now; the ring carries the change.
  assert.equal(
    formatTireIdentityLine({
      tireLabel: "Volante V5R",
      runNumber: 1,
      ageKnown: true,
      changed: true,
      previousTireLabel: "Sweep D32",
    }),
    "Volante V5R · run 1 (new)"
  );
});
