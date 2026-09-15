/**
 * Run: `npm run test:run-window` (this half needs no database).
 *
 * The shape of the `where` the run window's query gate produces (docs/STARTER_TIER_PLAN.md). The
 * database half, `runWindow.test.ts`, proves it against real reads.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeWhereToVisibleRuns } from "./runWindowExtension";

test("a read with no where at all still gets the visibility test", () => {
  assert.deepEqual(scopeWhereToVisibleRuns(undefined), { AND: [{ hiddenByPlanAt: null }] });
});

test("the caller's keys stay at the top level, so findUnique keeps its unique key", () => {
  assert.deepEqual(scopeWhereToVisibleRuns({ id: "r1" }), {
    id: "r1",
    AND: [{ hiddenByPlanAt: null }],
  });
});

test("an existing AND — object or list — is kept and appended to, never replaced", () => {
  assert.deepEqual(scopeWhereToVisibleRuns({ userId: "u", AND: { carId: "c" } }), {
    userId: "u",
    AND: [{ carId: "c" }, { hiddenByPlanAt: null }],
  });
  assert.deepEqual(scopeWhereToVisibleRuns({ AND: [{ carId: "c" }, { trackId: "t" }] }), {
    AND: [{ carId: "c" }, { trackId: "t" }, { hiddenByPlanAt: null }],
  });
});

test("a caller cannot widen the view: its own hiddenByPlanAt condition is ANDed, not merged", () => {
  // `hiddenByPlanAt: { not: null }` AND `hiddenByPlanAt: null` matches nothing — which is the
  // point. Only `runsIncludingHidden` can ask for hidden runs.
  assert.deepEqual(scopeWhereToVisibleRuns({ hiddenByPlanAt: { not: null } }), {
    hiddenByPlanAt: { not: null },
    AND: [{ hiddenByPlanAt: null }],
  });
});

test("the caller's where object is not mutated", () => {
  const where = { userId: "u", AND: [{ carId: "c" }] };
  scopeWhereToVisibleRuns(where);
  assert.deepEqual(where, { userId: "u", AND: [{ carId: "c" }] });
});
