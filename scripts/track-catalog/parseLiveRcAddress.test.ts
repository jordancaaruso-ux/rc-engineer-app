/**
 * Fixtures are verbatim rows from seeds/track-catalog/raw/liverc-tracks.jsonl — the messy ones,
 * not the tidy ones, because the tidy ones were never the risk.
 *
 * Run: npx tsx --test scripts/track-catalog/parseLiveRcAddress.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countryNameToIso,
  flagCandidate,
  normalizeTrackName,
  parseCityLine,
  parseLiveRcAddress,
} from "./parseLiveRcAddress";

test("US city line splits into city, state and zip", () => {
  assert.deepEqual(parseCityLine("Phoenix, AZ 85086"), {
    city: "Phoenix",
    region: "AZ",
    postcode: "85086",
  });
  assert.deepEqual(parseCityLine("Washington, UT 84780"), {
    city: "Washington",
    region: "UT",
    postcode: "84780",
  });
  // Lowercase town, real row from greene, ME.
  assert.deepEqual(parseCityLine("greene, ME 04236"), {
    city: "greene",
    region: "ME",
    postcode: "04236",
  });
});

test("zip+4 stays with the postcode", () => {
  assert.deepEqual(parseCityLine("Pittsburgh, PA 15235-1234"), {
    city: "Pittsburgh",
    region: "PA",
    postcode: "15235-1234",
  });
});

test("UK city line has no region and keeps a two-part postcode", () => {
  assert.deepEqual(parseCityLine("Hastings TN34 1EX"), {
    city: "Hastings",
    region: null,
    postcode: "TN34 1EX",
  });
  // Multi-word town, squashed postcode, all lowercase.
  assert.deepEqual(parseCityLine("st leonards on sea tn389ba"), {
    city: "st leonards on sea",
    region: null,
    postcode: "tn389ba",
  });
});

test("Canadian postcodes with a space survive", () => {
  assert.deepEqual(parseCityLine("Stratford, ON N5A 6S3"), {
    city: "Stratford",
    region: "ON",
    postcode: "N5A 6S3",
  });
  assert.deepEqual(parseCityLine("whitehorse, YT y1A0L4"), {
    city: "whitehorse",
    region: "YT",
    postcode: "y1A0L4",
  });
});

test("a spelled-out place after the comma is a city, not a region", () => {
  // "Wiri, Auckland 02025" — Wiri is a suburb of Auckland. Neither is a state.
  assert.deepEqual(parseCityLine("Wiri, Auckland 02025"), {
    city: "Wiri, Auckland",
    region: null,
    postcode: "02025",
  });
});

test("no-postcode lines keep the whole town", () => {
  assert.deepEqual(parseCityLine("Holen Hill SouthAust"), {
    city: "Holen Hill SouthAust",
    region: null,
    postcode: null,
  });
  assert.deepEqual(parseCityLine("Alice Springs 08710"), {
    city: "Alice Springs",
    region: null,
    postcode: "08710",
  });
});

test("a town that is only digits is never eaten entirely", () => {
  // Guard on the postcode-stripping loop: it must leave at least one token behind.
  assert.deepEqual(parseCityLine("100763"), {
    city: "100763",
    region: null,
    postcode: null,
  });
});

test("full three-line block parses end to end", () => {
  assert.deepEqual(
    parseLiveRcAddress(["204 Playa Della Rosita, Unit 10", "Washington, UT 84780", "United States"]),
    {
      street: "204 Playa Della Rosita, Unit 10",
      city: "Washington",
      region: "UT",
      postcode: "84780",
      countryCode: "us",
      countryName: "United States",
    }
  );
});

test("a four-line block still reads city and country off the end", () => {
  const parsed = parseLiveRcAddress([
    "Horntye Park",
    "Bohemia Road",
    "Hastings TN34 1EX",
    "United Kingdom",
  ]);
  assert.equal(parsed.city, "Hastings");
  assert.equal(parsed.countryCode, "gb");
  assert.equal(parsed.street, "Horntye Park, Bohemia Road");
});

test("an empty address block yields nulls rather than throwing", () => {
  // live.liverc.com and www.liverc.com are LiveRC itself, not tracks — they have no <address>.
  assert.deepEqual(parseLiveRcAddress([]), {
    street: null,
    city: null,
    region: null,
    postcode: null,
    countryCode: null,
    countryName: null,
  });
});

test("every country LiveRC writes maps to an ISO code", () => {
  const seen = [
    "United States", "Australia", "Canada", "United Kingdom", "China", "New Zealand",
    "Mexico", "Korea (South)", "Malaysia", "South Africa", "Hong Kong", "Sweden",
    "Puerto Rico", "Colombia", "Indonesia", "Estonia", "Brazil", "Philippines",
    "Singapore", "Dominican Republic", "Vietnam", "Brunei Darussalam", "Argentina",
    "Aruba", "Austria", "Azerbaijan", "Belgium", "Bulgaria", "Chile", "Costa Rica",
    "Czech Republic", "Finland", "Honduras", "Hungary", "Iceland", "Israel", "Japan",
    "Malta", "Mongolia", "Netherlands", "Oman", "Poland", "Portugal", "Switzerland",
    "Taiwan", "Thailand", "Trinidad and Tobago", "United Arab Emirates", "Venezuela",
  ];
  for (const name of seen) {
    assert.ok(countryNameToIso(name), `no ISO code for ${name}`);
  }
  assert.equal(countryNameToIso("Atlantis"), null);
});

test("name normaliser collapses punctuation and case", () => {
  assert.equal(normalizeTrackName("Ronny's RC"), normalizeTrackName("Ronnys R/C"));
  assert.equal(normalizeTrackName("Southside R/C Raceway"), "southsidercraceway");
  // Different tracks must not collide.
  assert.notEqual(normalizeTrackName("Southside RC"), normalizeTrackName("Northside RC"));
});

test("flags catch the doubtful rows and leave clean ones alone", () => {
  assert.deepEqual(
    flagCandidate({ name: "Thunder Valley Raceway", city: "Phoenix", countryCode: "us", postcode: "85086" }),
    []
  );
  assert.ok(flagCandidate({ name: "CHIHUAHUA RC", city: "Chihuahua", countryCode: "mx", postcode: "31115" }).includes("name-all-caps"));
  assert.ok(flagCandidate({ name: "rc track", city: "goa", countryCode: "us", postcode: "495599" }).includes("name-all-lowercase"));
  assert.ok(flagCandidate({ name: "Black Widow Hobbies", city: "Reno", countryCode: "us", postcode: "89501" }).includes("name-looks-retail"));
  assert.ok(flagCandidate({ name: "Flamingo Raceway", city: "Private", countryCode: "us", postcode: "Private" }).includes("placeholder-city"));
  assert.ok(flagCandidate({ name: "Adelaide RC", city: "Adelaide", countryCode: "au", postcode: "0000000" }).includes("placeholder-postcode"));
  assert.ok(flagCandidate({ name: "Bayz", city: null, countryCode: "us", postcode: null }).includes("missing-city"));
});
