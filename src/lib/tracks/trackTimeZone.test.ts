import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidIanaTimeZone,
  resolveTrackTimeZone,
  timeZoneForCoordinates,
} from "./trackTimeZone";

test("a Sydney pin resolves to Australia/Sydney", () => {
  assert.equal(timeZoneForCoordinates(-33.8688, 151.2093), "Australia/Sydney");
});

test("a Los Angeles pin resolves to America/Los_Angeles", () => {
  assert.equal(timeZoneForCoordinates(34.0522, -118.2437), "America/Los_Angeles");
});

test("a French pin resolves to Europe/Paris", () => {
  assert.equal(timeZoneForCoordinates(48.8566, 2.3522), "Europe/Paris");
});

test("missing or non-finite coordinates give null, never a throw", () => {
  assert.equal(timeZoneForCoordinates(null, 151), null);
  assert.equal(timeZoneForCoordinates(-33, undefined), null);
  assert.equal(timeZoneForCoordinates(Number.NaN, 151), null);
  assert.equal(timeZoneForCoordinates(999, 999), null);
});

test("the stored column wins over the pin", () => {
  assert.equal(
    resolveTrackTimeZone({ timeZone: "Europe/Berlin", latitude: -33.8688, longitude: 151.2093 }),
    "Europe/Berlin",
  );
});

test("an invalid stored column is ignored and the pin is used", () => {
  assert.equal(
    resolveTrackTimeZone({ timeZone: "Mars/Olympus", latitude: -33.8688, longitude: 151.2093 }),
    "Australia/Sydney",
  );
});

test("no column and no pin falls back to the owner's zone, then UTC", () => {
  assert.equal(resolveTrackTimeZone({}, { timeZone: "Australia/Melbourne" }), "Australia/Melbourne");
  assert.equal(resolveTrackTimeZone({}, { timeZone: "not-a-zone" }), "UTC");
  assert.equal(resolveTrackTimeZone({}, null), "UTC");
});

test("isValidIanaTimeZone accepts real zones and rejects junk", () => {
  assert.equal(isValidIanaTimeZone("Australia/Sydney"), true);
  assert.equal(isValidIanaTimeZone(" UTC "), true);
  assert.equal(isValidIanaTimeZone(""), false);
  assert.equal(isValidIanaTimeZone(null), false);
  assert.equal(isValidIanaTimeZone("Nowhere/Land"), false);
});
