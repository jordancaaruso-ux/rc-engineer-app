/**
 * Run: `npx tsx src/lib/lapImport/pickPrimarySessionDriver.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickPrimarySessionDriver } from "@/lib/lapImport/pickPrimarySessionDriver";
import type { LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";

function driver(driverId: string, driverName: string): LapUrlSessionDriver {
  return {
    id: `driver-${driverId}`,
    driverId,
    driverName,
    normalizedName: driverName.toLowerCase(),
    laps: [15.0, 15.1, 15.0],
    lapCount: 3,
  };
}

test("single driver is returned regardless of opts", () => {
  const only = driver("99", "Someone Else");
  const picked = pickPrimarySessionDriver([only], {
    liveRcDriverId: "42",
    liveRcDriverName: "Jordan Caruso",
  });
  assert.equal(picked.driverId, "99");
});

test("id match wins when the row name also agrees", () => {
  const drivers = [driver("7", "Alex Rival"), driver("42", "Jordan Caruso")];
  const picked = pickPrimarySessionDriver(drivers, {
    liveRcDriverId: "42",
    liveRcDriverName: "Jordan Caruso",
  });
  assert.equal(picked.driverId, "42");
});

test("stale id colliding with a different driver is rejected; falls back to name", () => {
  // Stored id 42 came from another event; here entry 42 is a different person.
  const drivers = [driver("42", "Alex Rival"), driver("8", "Jordan Caruso")];
  const picked = pickPrimarySessionDriver(drivers, {
    liveRcDriverId: "42",
    liveRcDriverName: "Jordan Caruso",
  });
  assert.equal(picked.driverId, "8", "should pick the name match, not the colliding id");
});

test("id is trusted when no name is known", () => {
  const drivers = [driver("7", "Alex Rival"), driver("42", "Jordan Caruso")];
  const picked = pickPrimarySessionDriver(drivers, {
    liveRcDriverId: "42",
    liveRcDriverName: null,
  });
  assert.equal(picked.driverId, "42");
});

test("falls back to first row when neither id nor name matches", () => {
  const drivers = [driver("1", "First Row"), driver("2", "Second Row")];
  const picked = pickPrimarySessionDriver(drivers, {
    liveRcDriverId: "999",
    liveRcDriverName: "Nobody Here",
  });
  assert.equal(picked.driverId, "1");
});

console.log("pickPrimarySessionDriver.test.ts OK");
