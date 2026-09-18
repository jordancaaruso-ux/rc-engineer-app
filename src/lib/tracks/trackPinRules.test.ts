/**
 * Run: npx tsx --test src/lib/tracks/trackPinRules.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptSighting,
  addressGeocodeQueries,
  agreedPin,
  canReplacePin,
  pinRank,
} from "@/lib/tracks/trackPinRules";

const BORONIA = { latitude: -37.8606, longitude: 145.2848 };

test("no pin can be filled by anything", () => {
  assert.equal(pinRank({}), 0);
  assert.ok(canReplacePin({}, "town"));
});

test("a better automatic source replaces a rougher one, never the reverse", () => {
  const town = { ...BORONIA, locationSource: "town" };
  const liverc = { ...BORONIA, locationSource: "liverc_address" };
  assert.ok(canReplacePin(town, "liverc_address"));
  assert.ok(canReplacePin(liverc, "drivers"));
  assert.ok(!canReplacePin(liverc, "town"));
  assert.ok(!canReplacePin({ ...BORONIA, locationSource: "drivers" }, "liverc_address"));
});

test("a pin set by hand, or by an older path with no source, is never replaced", () => {
  for (const locationSource of ["device", "manual_paste", null, "osm"]) {
    assert.ok(!canReplacePin({ ...BORONIA, locationSource }, "drivers"), String(locationSource));
  }
});

test("a phone far from a rough pin is somebody's house, not the track", () => {
  const track = { ...BORONIA, locationSource: "liverc_address" };
  assert.ok(acceptSighting(track, { latitude: -37.87, longitude: 145.29 }));
  // Melbourne CBD, ~25 km away.
  assert.ok(!acceptSighting(track, { latitude: -37.8136, longitude: 144.9631 }));
});

test("a track with no pin keeps any spot; one confirmed by drivers keeps none", () => {
  assert.ok(acceptSighting({}, { latitude: -37.8136, longitude: 144.9631 }));
  assert.ok(!acceptSighting({ ...BORONIA, locationSource: "drivers" }, BORONIA));
  assert.ok(!acceptSighting({ ...BORONIA, locationSource: "device" }, BORONIA));
});

test("one driver twice never sets a pin", () => {
  const latest = { ...BORONIA, userId: "a" };
  assert.equal(agreedPin(latest, [{ ...BORONIA, userId: "a" }]), null);
});

test("two drivers within 200 m set the pin to their middle", () => {
  const latest = { latitude: -37.8606, longitude: 145.2848, userId: "a" };
  const other = { latitude: -37.8616, longitude: 145.2848, userId: "b" }; // ~111 m south
  const pin = agreedPin(latest, [other]);
  assert.ok(pin);
  assert.ok(Math.abs(pin.latitude - -37.8611) < 1e-9);
});

test("two drivers far apart do not agree", () => {
  const latest = { latitude: -37.8606, longitude: 145.2848, userId: "a" };
  const other = { latitude: -37.87, longitude: 145.2848, userId: "b" }; // ~1 km
  assert.equal(agreedPin(latest, [other]), null);
});

test("address queries never carry the postcode, strip units, and end on the town", () => {
  const queries = addressGeocodeQueries({
    street: "204 Playa Della Rosita, Unit 10",
    city: "Knoxfield",
    region: "VIC",
    countryName: "Australia",
  }).map((q) => q.toString());
  assert.ok(queries.every((q) => !q.includes("Unit")));
  assert.equal(queries[0], new URLSearchParams({ street: "204 Playa Della Rosita", city: "Knoxfield", country: "Australia", state: "VIC" }).toString());
  assert.equal(queries.at(-1), new URLSearchParams({ q: "Knoxfield, VIC, Australia" }).toString());
});

test("a placeholder street leaves only the town query", () => {
  const queries = addressGeocodeQueries({
    street: "None Listed",
    city: "Phoenix",
    region: "AZ",
    countryName: "United States",
  });
  assert.equal(queries.length, 1);
});
