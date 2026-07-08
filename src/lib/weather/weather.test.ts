/**
 * Run: `npx tsx src/lib/weather/weather.test.ts`  (or `npm run test:weather`)
 *
 * Offline — no network. The Open-Meteo fetch is exercised via an injected mock.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { temperatureBand, temperatureBandLabel } from "@/lib/weather/temperatureBands";
import {
  describeSky,
  formatConditionsSummary,
  isConditionsEmpty,
  skyLabelFromCloudCover,
  EMPTY_RUN_CONDITIONS,
} from "@/lib/weather/conditions";
import {
  buildOpenMeteoRequest,
  fetchRunConditionsFromOpenMeteo,
  floorToUtcHourIso,
  pickHourlyObservation,
  WeatherFetchError,
} from "@/lib/weather/openMeteo";

// --- temperature bands ---

test("temperatureBand boundaries are cool/mild/warm/hot", () => {
  assert.equal(temperatureBand(-3), "cool");
  assert.equal(temperatureBand(15.9), "cool");
  assert.equal(temperatureBand(16), "mild");
  assert.equal(temperatureBand(22.9), "mild");
  assert.equal(temperatureBand(23), "warm");
  assert.equal(temperatureBand(29.9), "warm");
  assert.equal(temperatureBand(30), "hot");
  assert.equal(temperatureBand(41), "hot");
});

test("temperatureBand returns null for missing/non-finite", () => {
  assert.equal(temperatureBand(null), null);
  assert.equal(temperatureBand(undefined), null);
  assert.equal(temperatureBand(NaN), null);
});

test("temperatureBandLabel includes the range", () => {
  assert.match(temperatureBandLabel("warm"), /23/);
});

// --- sky labels + summary ---

test("describeSky prefers weather code and flags wet", () => {
  assert.deepEqual(describeSky(0, 0), { label: "Clear", wet: false });
  assert.deepEqual(describeSky(3, 5), { label: "Overcast", wet: false });
  assert.equal(describeSky(63, null)?.wet, true); // rain
  assert.equal(describeSky(95, null)?.label, "Thunderstorm");
});

test("describeSky falls back to cloud cover when no code", () => {
  assert.equal(describeSky(null, 0)?.label, "Clear");
  assert.equal(describeSky(null, 100)?.label, "Overcast");
  assert.equal(describeSky(null, null), null);
});

test("skyLabelFromCloudCover buckets", () => {
  assert.equal(skyLabelFromCloudCover(0), "Clear");
  assert.equal(skyLabelFromCloudCover(50), "Partly cloudy");
  assert.equal(skyLabelFromCloudCover(95), "Overcast");
});

test("formatConditionsSummary joins temp and sky, null when empty", () => {
  assert.equal(formatConditionsSummary(EMPTY_RUN_CONDITIONS), null);
  assert.equal(
    formatConditionsSummary({ ...EMPTY_RUN_CONDITIONS, airTempC: 18.4, weatherCode: 0 }),
    "18°C · Clear"
  );
  assert.equal(
    formatConditionsSummary({ ...EMPTY_RUN_CONDITIONS, airTempC: 26.6 }),
    "27°C"
  );
});

test("isConditionsEmpty ignores coords/source-only readings", () => {
  assert.equal(isConditionsEmpty(EMPTY_RUN_CONDITIONS), true);
  assert.equal(
    isConditionsEmpty({ ...EMPTY_RUN_CONDITIONS, latitude: 51, longitude: 0, source: "manual" }),
    true
  );
  assert.equal(isConditionsEmpty({ ...EMPTY_RUN_CONDITIONS, airTempC: 20 }), false);
});

// --- endpoint selection ---

test("buildOpenMeteoRequest uses forecast for recent sessions", () => {
  const now = new Date("2026-07-06T12:00:00Z");
  const req = buildOpenMeteoRequest({
    latitude: 51.5074,
    longitude: -0.1278,
    at: new Date("2026-07-05T14:30:00Z"),
    now,
  });
  assert.equal(req.kind, "open-meteo-forecast");
  assert.match(req.url, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(req.url, /start_date=2026-07-05/);
  assert.match(req.url, /wind_speed_unit=kmh/);
  // coordinates rounded to 2dp
  assert.match(req.url, /latitude=51\.51/);
  assert.equal(req.targetHourIso, "2026-07-05T14:00");
});

test("buildOpenMeteoRequest uses archive for old sessions (>90d)", () => {
  const now = new Date("2026-07-06T12:00:00Z");
  const req = buildOpenMeteoRequest({
    latitude: 13.7,
    longitude: 100.5,
    at: new Date("2026-01-01T09:00:00Z"),
    now,
  });
  assert.equal(req.kind, "open-meteo-archive");
  assert.match(req.url, /archive-api\.open-meteo\.com/);
  assert.match(req.url, /start_date=2026-01-01/);
});

test("floorToUtcHourIso floors to the hour in UTC", () => {
  assert.equal(floorToUtcHourIso(new Date("2026-07-05T14:37:09Z")), "2026-07-05T14:00");
});

// --- hourly parsing ---

const HOURLY_BODY = {
  hourly: {
    time: ["2026-07-05T13:00", "2026-07-05T14:00", "2026-07-05T15:00"],
    temperature_2m: [17.2, 18.9, 20.1],
    relative_humidity_2m: [61, 58.6, 55],
    cloud_cover: [10, 5, 0],
    weather_code: [1, 0, 0],
    wind_speed_10m: [8.3, 9.1, 10.0],
    wind_direction_10m: [180, 190.4, 200],
  },
};

test("pickHourlyObservation extracts the exact hour and rounds ints", () => {
  const obs = pickHourlyObservation(HOURLY_BODY, "2026-07-05T14:00");
  assert.ok(obs);
  assert.equal(obs!.airTempC, 18.9);
  assert.equal(obs!.humidityPct, 59); // rounded
  assert.equal(obs!.cloudCoverPct, 5);
  assert.equal(obs!.weatherCode, 0);
  assert.equal(obs!.windKph, 9.1);
  assert.equal(obs!.windDirDeg, 190); // rounded
  assert.equal(obs!.observedAtIso, "2026-07-05T14:00:00.000Z");
});

test("pickHourlyObservation falls back to nearest hour", () => {
  const obs = pickHourlyObservation(HOURLY_BODY, "2026-07-05T14:40");
  assert.ok(obs);
  // 14:40 is nearer 15:00 than 14:00
  assert.equal(obs!.airTempC, 20.1);
});

test("pickHourlyObservation returns null for empty hourly", () => {
  assert.equal(pickHourlyObservation({ hourly: { time: [] } }, "2026-07-05T14:00"), null);
  assert.equal(pickHourlyObservation(null, "2026-07-05T14:00"), null);
});

// --- fetch orchestration (mocked) ---

test("fetchRunConditionsFromOpenMeteo returns normalized conditions", async () => {
  const conditions = await fetchRunConditionsFromOpenMeteo(
    { latitude: 51.5074, longitude: -0.1278, atIso: "2026-07-05T14:20:00Z" },
    {
      now: new Date("2026-07-06T12:00:00Z"),
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => HOURLY_BODY }),
    }
  );
  assert.equal(conditions.airTempC, 18.9);
  assert.equal(conditions.source, "open-meteo-forecast");
  assert.equal(conditions.latitude, 51.51);
  assert.equal(conditions.longitude, -0.13);
});

test("fetchRunConditionsFromOpenMeteo throws on non-ok response", async () => {
  await assert.rejects(
    fetchRunConditionsFromOpenMeteo(
      { latitude: 1, longitude: 2 },
      { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) }
    ),
    (e: unknown) => e instanceof WeatherFetchError && /429/.test((e as Error).message)
  );
});

test("fetchRunConditionsFromOpenMeteo throws when no reading for the hour", async () => {
  await assert.rejects(
    fetchRunConditionsFromOpenMeteo(
      { latitude: 1, longitude: 2 },
      { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ hourly: { time: [] } }) }) }
    ),
    WeatherFetchError
  );
});

console.log("weather.test.ts: all tests registered");
