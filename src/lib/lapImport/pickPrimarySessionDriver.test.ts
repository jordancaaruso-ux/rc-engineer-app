/**
 * Run: `npx tsx src/lib/lapImport/pickPrimarySessionDriver.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchPrimarySessionDriver,
  pickPrimarySessionDriver,
} from "@/lib/lapImport/pickPrimarySessionDriver";
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

test("server sessionHint match beats P1 fallback (Speedhive transponder match)", () => {
  // User has no LiveRC identity configured; the server matched their row by transponder.
  const drivers = [driver("sh-1-1", "Alex Rival"), driver("sh-1-3", "Jordan Caruso")];
  const picked = pickPrimarySessionDriver(drivers, {
    liveRcDriverId: null,
    liveRcDriverName: null,
    sessionHintName: "Jordan Caruso",
  });
  assert.equal(picked.driverId, "sh-1-3");
});

test("local LiveRC name match still beats sessionHint", () => {
  const drivers = [driver("1", "Jordan Caruso"), driver("2", "Alex Rival")];
  const picked = pickPrimarySessionDriver(drivers, {
    liveRcDriverId: null,
    liveRcDriverName: "Jordan Caruso",
    sessionHintName: "Alex Rival",
  });
  assert.equal(picked.driverId, "1", "explicit local identity outranks the server hint");
});

test("sessionHint that matches no row still falls back to P1", () => {
  const drivers = [driver("1", "First Row"), driver("2", "Second Row")];
  const picked = pickPrimarySessionDriver(drivers, {
    liveRcDriverId: null,
    liveRcDriverName: null,
    sessionHintName: "Ghost Driver",
  });
  assert.equal(picked.driverId, "1");
});

console.log("pickPrimarySessionDriver.test.ts OK");

test("the lap step's match never falls back to the first row", () => {
  // Pasting a 10-driver LiveRC race preselected the winner as "Your laps" for a racer whose name
  // is not saved yet, and the Engineer read the winner's laps as theirs (test drive, 2026-09-26).
  const drivers = [driver("1", "KAWASHIMA"), driver("5", "OHTSUKA")];
  assert.equal(
    matchPrimarySessionDriver(drivers, { liveRcDriverId: null, liveRcDriverName: null }),
    null
  );
  assert.equal(
    matchPrimarySessionDriver(drivers, { liveRcDriverId: "999", liveRcDriverName: "Haruto Nobody" }),
    null
  );
  // What the racer told us still picks their row, and a lone row is theirs.
  assert.equal(
    matchPrimarySessionDriver(drivers, { liveRcDriverId: null, liveRcDriverName: "Ohtsuka" })?.driverId,
    "5"
  );
  assert.equal(
    matchPrimarySessionDriver(drivers, {
      liveRcDriverId: null,
      liveRcDriverName: null,
      sessionHintName: "OHTSUKA",
    })?.driverId,
    "5"
  );
  assert.equal(
    matchPrimarySessionDriver([driver("9", "Solo")], { liveRcDriverId: null, liveRcDriverName: null })?.driverId,
    "9"
  );
});
