import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultUnitSystemForTimeZone,
  formatTemp,
  formatTempRange,
  formatWind,
  parseUnitSystem,
  resolveUnitSystem,
  tempFigure,
  tempFromInput,
  windFigure,
  windFromInput,
} from "@/lib/units/unitSystem";

test("a US time zone starts imperial; everywhere else metric", () => {
  for (const tz of [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Indiana/Indianapolis",
    "America/Kentucky/Louisville",
    "America/North_Dakota/Center",
    "US/Eastern",
  ]) {
    assert.equal(defaultUnitSystemForTimeZone(tz), "imperial", tz);
  }
  for (const tz of [
    "Australia/Sydney",
    "Australia/Brisbane",
    "America/Toronto",
    "America/Vancouver",
    "America/Mexico_City",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Tokyo",
    "UTC",
    "",
  ]) {
    assert.equal(defaultUnitSystemForTimeZone(tz), "metric", tz);
  }
  assert.equal(defaultUnitSystemForTimeZone(null), "metric");
  assert.equal(defaultUnitSystemForTimeZone(undefined), "metric");
});

test("a stored choice beats the time zone, and junk falls back to the zone", () => {
  assert.equal(resolveUnitSystem("metric", "America/Chicago"), "metric");
  assert.equal(resolveUnitSystem("imperial", "Australia/Sydney"), "imperial");
  assert.equal(resolveUnitSystem("kelvin", "America/Chicago"), "imperial");
  assert.equal(resolveUnitSystem(null, "Australia/Sydney"), "metric");
  assert.equal(parseUnitSystem("imperial"), "imperial");
  assert.equal(parseUnitSystem(" imperial"), null);
});

test("metric output reads exactly as it did before the switch existed", () => {
  assert.equal(formatTemp(23.4, "metric"), "23°C");
  assert.equal(formatTemp(23.4, "metric", { space: true, decimals: 1 }), "23.4 °C");
  assert.equal(formatWind(12.6, "metric"), "13 km/h");
  assert.equal(tempFigure(23.4, "metric"), "23.4");
  assert.equal(windFigure(12.6, "metric"), "12.6");
  assert.equal(tempFromInput("metric", 23.4), 23.4);
  assert.equal(windFromInput("metric", 12.6), 12.6);
});

test("imperial converts on the way out", () => {
  assert.equal(formatTemp(30, "imperial"), "86°F");
  assert.equal(formatTemp(0, "imperial"), "32°F");
  assert.equal(formatTemp(-40, "imperial"), "-40°F");
  assert.equal(formatWind(16.09344, "imperial"), "10 mph");
  assert.equal(formatTemp(null, "imperial"), null);
  assert.equal(formatWind(undefined, "imperial"), null);
});

test("what a driver types in °F or mph comes back exactly as typed", () => {
  for (let f = -20; f <= 230; f += 1) {
    assert.equal(tempFigure(tempFromInput("imperial", f), "imperial"), String(f), `${f}°F`);
  }
  for (let f = 60; f <= 110; f += 0.5) {
    assert.equal(Number(tempFigure(tempFromInput("imperial", f), "imperial")), f, `${f}°F`);
  }
  for (let mph = 0; mph <= 60; mph += 1) {
    assert.equal(windFigure(windFromInput("imperial", mph), "imperial"), String(mph), `${mph} mph`);
  }
});

test("a range collapses when both ends round to the same figure", () => {
  assert.equal(formatTempRange(18.2, 18.4, "metric"), "18°C");
  assert.equal(formatTempRange(18, 23, "metric"), "18–23°C");
  assert.equal(formatTempRange(18.2, 18.4, "metric", { space: true, decimals: 1 }), "18.2–18.4 °C");
  assert.equal(formatTempRange(20, 25, "imperial"), "68–77°F");
});
