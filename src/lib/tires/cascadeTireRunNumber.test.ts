/**
 * Run: `npx tsx src/lib/tires/cascadeTireRunNumber.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planTireRunNumberCascade,
  withTireRunNumberInSnapshot,
  type StintRunForCascade,
} from "@/lib/tires/cascadeTireRunNumber";

const run = (id: string, tireRunNumber: number, setupSnapshotId: string | null = `snap-${id}`): StintRunForCascade => ({
  id,
  tireRunNumber,
  setupSnapshotId,
});

test("a correction of +2 moves every later run on the set by +2", () => {
  const steps = planTireRunNumberCascade(2, [run("b", 5), run("c", 6), run("d", 7)]);
  assert.deepEqual(
    steps.map((s) => [s.runId, s.tireRunNumber]),
    [
      ["b", 7],
      ["c", 8],
      ["d", 9],
    ]
  );
});

test("gaps in a stint survive the shift — spacing is not invented", () => {
  const steps = planTireRunNumberCascade(1, [run("b", 5), run("c", 9)]);
  assert.deepEqual(
    steps.map((s) => s.tireRunNumber),
    [6, 10]
  );
});

test("no delta means no writes", () => {
  assert.deepEqual(planTireRunNumberCascade(0, [run("b", 5)]), []);
});

test("a downward correction clamps at 1 rather than going negative", () => {
  const steps = planTireRunNumberCascade(-4, [run("b", 2), run("c", 6)]);
  assert.deepEqual(
    steps.map((s) => s.tireRunNumber),
    [1, 2]
  );
});

test("a run already sitting on the clamped value is not rewritten", () => {
  const steps = planTireRunNumberCascade(-4, [run("b", 1), run("c", 6)]);
  assert.deepEqual(
    steps.map((s) => s.runId),
    ["c"]
  );
});

test("the snapshot id rides along so the sheet can be moved with the row", () => {
  const steps = planTireRunNumberCascade(1, [run("b", 5, "snap-b"), run("c", 6, null)]);
  assert.deepEqual(
    steps.map((s) => s.setupSnapshotId),
    ["snap-b", null]
  );
});

test("the snapshot's tire value follows the run's new number", () => {
  const patched = withTireRunNumberInSnapshot(
    { tires: { tireTypeId: "sweep-32r", displayName: "Sweep 32R", tireRunNumber: 4 }, camber_front: "-1.5" },
    6
  );
  assert.ok(patched);
  assert.equal((patched.tires as { tireRunNumber?: number }).tireRunNumber, 6);
  // Everything else is left exactly as it was.
  assert.equal(patched.camber_front, "-1.5");
});

test("both tire field keys are patched", () => {
  const patched = withTireRunNumberInSnapshot(
    {
      tires: { tireTypeId: "sweep-32r", tireRunNumber: 4 },
      tires_setup: { tireTypeId: "sweep-32r", tireRunNumber: 4 },
    },
    6
  );
  assert.ok(patched);
  assert.equal((patched.tires as { tireRunNumber?: number }).tireRunNumber, 6);
  assert.equal((patched.tires_setup as { tireRunNumber?: number }).tireRunNumber, 6);
});

test("a snapshot with no tire value, or already correct, asks for no write", () => {
  assert.equal(withTireRunNumberInSnapshot({ camber_front: "-1.5" }, 6), null);
  assert.equal(withTireRunNumberInSnapshot({ tires: "Sweep 32R" }, 6), null);
  assert.equal(
    withTireRunNumberInSnapshot({ tires: { tireTypeId: "sweep-32r", tireRunNumber: 6 } }, 6),
    null
  );
  assert.equal(withTireRunNumberInSnapshot(null, 6), null);
});

test("an age-unknown count still moves — it is relative to the same origin", () => {
  const patched = withTireRunNumberInSnapshot(
    { tires: { tireTypeId: "sweep-32r", tireRunNumber: 3, tireAgeKnown: false } },
    5
  );
  assert.ok(patched);
  assert.deepEqual(patched.tires, {
    tireTypeId: "sweep-32r",
    tireRunNumber: 5,
    tireAgeKnown: false,
    displayName: undefined,
  });
});
