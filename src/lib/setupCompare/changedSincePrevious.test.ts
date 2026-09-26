import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSetupChangedRows, setupChangedRowsSincePrevious, type SetupChangedRow } from "./changedSincePrevious";

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

// ---- names that contain a number are names (founder report 2026-09-19) ----

const changes = (now: Record<string, unknown>, was: Record<string, unknown>) =>
  setupChangedRowsSincePrevious(now, was).map((r) => `${r.key}: ${r.value} <- ${r.previousValue}`);

test("a body shell reads as its name, not as the thickness inside it", () => {
  assert.deepEqual(changes({ body: "Wolverine 0.5", wing: "Speciale 0.4" }, { body: "Twister 0.7", wing: "Speciale 0.7" }), [
    "body: Wolverine 0.5 <- Twister 0.7",
    "wing: Speciale 0.4 <- Speciale 0.7",
  ]);
});

test("a swap that keeps the same number inside the name is still a change", () => {
  assert.deepEqual(changes({ body: "Wolverine 0.7" }, { body: "Twister 0.7" }), ["body: Wolverine 0.7 <- Twister 0.7"]);
  assert.deepEqual(changes({ motor: "HW G4R" }, { motor: "Orca G4R" }), ["motor: HW G4R <- Orca G4R"]);
});

test("a plain number, with or without a unit, still compares as a number", () => {
  // Same value written two ways is not a change…
  assert.deepEqual(changes({ some_gap: "5.40" }, { some_gap: "5.4" }), []);
  assert.deepEqual(changes({ some_gap: "5.4mm" }, { some_gap: "5.4 mm" }), []);
  // …and a real change still is.
  assert.deepEqual(changes({ some_gap: "5.4 mm" }, { some_gap: "5.6 mm" }), ["some_gap: 5.4 <- 5.6"]);
});

// ---- an object is never printed as text (test drive 2026-09-26) ----

test("a tyre prints as its name and run, never as [object Object]", () => {
  // Jack's run from a saved setup held no tyre; the run before held one.
  const tyre = { tireTypeId: "t1", displayName: "AKA Array Super Soft", tireRunNumber: 5, tireAgeKnown: true };
  assert.deepEqual(changes({ box_1: "4" }, { box_1: "3", tires: tyre }), [
    "box_1: 4 <- 3",
    "tires: — <- AKA Array Super Soft · run 5",
  ]);
});

test("the text an old String(object) write left in a box reads as a blank", () => {
  assert.deepEqual(changes({ box_2: "[object Object]" }, { box_2: "5" }), ["box_2: — <- 5"]);
});
