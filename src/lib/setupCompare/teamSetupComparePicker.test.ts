/**
 * Run: `npx tsx src/lib/setupCompare/teamSetupComparePicker.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { carsShareSetupSheetScope, setupSheetScopeFromCar } from "@/lib/setupCompare/setupSheetScope";
import { filterRunsForTeamSetupComparePicker } from "@/lib/setupCompare/teamSetupComparePicker";

test("setupSheetScope prefers model id over template", () => {
  const scope = setupSheetScopeFromCar({
    setupSheetModelId: "model-1",
    setupSheetTemplate: "awesomatix_a800rr",
  });
  assert.equal(scope?.setupSheetModelId, "model-1");
});

test("carsShareSetupSheetScope matches model id", () => {
  const a = setupSheetScopeFromCar({ setupSheetModelId: "m1", setupSheetTemplate: null })!;
  const b = setupSheetScopeFromCar({ setupSheetModelId: "m1", setupSheetTemplate: "other" })!;
  assert.equal(carsShareSetupSheetScope(a, b), true);
});

test("filterRunsForTeamSetupComparePicker includes viewer runs on matching scope", () => {
  const anchor = {
    id: "peer-run",
    userId: "peer",
    carId: "peer-car",
    car: { id: "peer-car", setupSheetModelId: "sheet-a", setupSheetTemplate: null },
  };
  const candidates = [
    anchor,
    {
      id: "peer-other",
      userId: "peer",
      carId: "peer-car",
      car: { id: "peer-car", setupSheetModelId: "sheet-a", setupSheetTemplate: null },
    },
    {
      id: "my-run",
      userId: "me",
      carId: "my-car",
      car: { id: "my-car", setupSheetModelId: "sheet-a", setupSheetTemplate: null },
    },
    {
      id: "other-template",
      userId: "me",
      carId: "other-car",
      car: { id: "other-car", setupSheetModelId: "sheet-b", setupSheetTemplate: null },
    },
  ];
  const picked = filterRunsForTeamSetupComparePicker(anchor, candidates, "me");
  assert.deepEqual(
    picked.map((r) => r.id).sort(),
    ["my-run", "peer-other"]
  );
});
