import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSetupChangedRows, type SetupChangedRow } from "./changedSincePrevious";

const row = (key: string, label = key): SetupChangedRow => ({ key, label, value: "1", previousValue: "2" });

test("the knobs every car has lead, in the registry's order, not the alphabet's", () => {
  const ordered = orderSetupChangedRows([
    row("diff_oil", "Diff oil"),
    row("spring_front", "Spring (Front)"),
    row("camber_rear", "Camber (Rear)"),
    row("ride_height_front", "Ride height (Front)"),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.key),
    ["camber_rear", "ride_height_front", "spring_front", "diff_oil"]
  );
});

test("a chassis's own boxes follow, alphabetically by the name the driver reads", () => {
  const ordered = orderSetupChangedRows([
    row("pinion", "pinion"),
    row("final_drive_ratio", "final drive ratio"),
    row("damper_percent_front", "damper percent front"),
    row("toe_rear", "Toe (Rear)"),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.key),
    ["toe_rear", "damper_percent_front", "final_drive_ratio", "pinion"]
  );
});

test("an alias pools with its universal parameter", () => {
  const ordered = orderSetupChangedRows([row("aaa_custom", "Aaa custom"), row("shock_oil_front", "Shock Oil (Front)")]);
  assert.equal(ordered[0]!.key, "shock_oil_front");
});

test("the list handed in is not reordered in place", () => {
  const rows = [row("pinion"), row("camber_front", "Camber (Front)")];
  orderSetupChangedRows(rows);
  assert.equal(rows[0]!.key, "pinion");
});
