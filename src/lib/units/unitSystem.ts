/**
 * Metric or imperial — the one units switch (Settings, founder call 2026-09-24).
 *
 * Every figure is STORED metric (°C, km/h) whatever the driver reads it in. The switch only
 * changes what a driver sees and types for the readings that differ by country: air and track
 * temperature, wind, and the tyre-warmer temperature. Setup numbers never convert. RC setup is
 * millimetres and degrees in the US too, and a spring rate is in whatever unit its manufacturer
 * printed on the sheet (Associated and TLR print lb/in, the Awesomatix sheet gf/mm).
 *
 * Storing one unit is what keeps stats, the setup aggregations and the Engineer from ever mixing
 * two, and what lets an American and their Australian teammate each read the same run in their
 * own unit. Pure module: the client provider and the server resolvers both build on it.
 */

export type UnitSystem = "metric" | "imperial";

export function parseUnitSystem(raw: unknown): UnitSystem | null {
  return raw === "metric" || raw === "imperial" ? raw : null;
}

/*
 * The fifty states and the US territories that read °F, including the old `US/*` and backward
 * link names a device can still report. Canada and Mexico share `America/*` but are metric, which
 * is why this is a list and not a prefix.
 */
const US_TIME_ZONE =
  /^(America\/(New_York|Detroit|Chicago|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Atka|Menominee|Indianapolis|Fort_Wayne|Knox_IN|Louisville|Shiprock|Puerto_Rico|St_Thomas|Indiana\/[A-Za-z_]+|Kentucky\/[A-Za-z_]+|North_Dakota\/[A-Za-z_]+)|Pacific\/(Honolulu|Johnston|Midway|Guam|Saipan|Pago_Pago|Samoa)|US\/[A-Za-z-]+|Navajo|EST5EDT|CST6CDT|MST7MDT|PST8PDT)$/;

/**
 * What a driver who has never touched the switch reads: imperial on a device set to a US time
 * zone, metric everywhere else (founder delegated the call, 2026-09-24). The zone is the only
 * country signal the app already holds for every driver, and it needs no permission prompt.
 */
export function defaultUnitSystemForTimeZone(timeZone: string | null | undefined): UnitSystem {
  return timeZone && US_TIME_ZONE.test(timeZone.trim()) ? "imperial" : "metric";
}

/** The driver's stored choice when there is one, else the default for their zone. */
export function resolveUnitSystem(
  stored: string | null | undefined,
  timeZone: string | null | undefined
): UnitSystem {
  return parseUnitSystem(stored) ?? defaultUnitSystemForTimeZone(timeZone);
}

/* ── Conversions ─────────────────────────────────────────────────────────────── */

const KM_PER_MILE = 1.609344;

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function kphToMph(kph: number): number {
  return kph / KM_PER_MILE;
}

export function mphToKph(mph: number): number {
  return mph * KM_PER_MILE;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function tempUnit(units: UnitSystem): "°C" | "°F" {
  return units === "imperial" ? "°F" : "°C";
}

export function windUnit(units: UnitSystem): "km/h" | "mph" {
  return units === "imperial" ? "mph" : "km/h";
}

/** A stored °C figure in the driver's unit. Unrounded: round where it is drawn. */
export function tempIn(units: UnitSystem, celsius: number): number {
  return units === "imperial" ? celsiusToFahrenheit(celsius) : celsius;
}

/** A stored km/h figure in the driver's unit. Unrounded: round where it is drawn. */
export function windIn(units: UnitSystem, kph: number): number {
  return units === "imperial" ? kphToMph(kph) : kph;
}

/**
 * A temperature the driver typed or dialled, back to storage (°C).
 *
 * Two decimals, not whole degrees: 94 °F is 34.44 °C, which reads back as 94.0 °F. Stored as a
 * whole 34 °C it would come back as 93 °F, a number the driver never typed. Metric input is
 * stored exactly as typed.
 */
export function tempFromInput(units: UnitSystem, value: number): number {
  return units === "imperial" ? round2(fahrenheitToCelsius(value)) : value;
}

/** A wind speed the driver typed, back to storage (km/h). Two decimals, for the same reason. */
export function windFromInput(units: UnitSystem, value: number): number {
  return units === "imperial" ? round2(mphToKph(value)) : value;
}

/**
 * "23°C" / "74°F": whole degrees, the way a reading is said out loud. `space` gives "23 °C",
 * the Debrief card's spacing.
 */
export function formatTemp(
  celsius: number | null | undefined,
  units: UnitSystem,
  opts?: { space?: boolean; decimals?: 0 | 1 }
): string | null {
  if (!isFiniteNumber(celsius)) return null;
  const v = tempIn(units, celsius);
  const figure = opts?.decimals === 1 ? round1(v) : Math.round(v);
  return `${figure}${opts?.space ? " " : ""}${tempUnit(units)}`;
}

/**
 * "18–23°C", or a single figure when both ends read the same once rounded (a day at 18.2 and
 * 18.4 is "18°C", not "18–18°C").
 */
export function formatTempRange(
  minC: number,
  maxC: number,
  units: UnitSystem,
  opts?: { space?: boolean; decimals?: 0 | 1 }
): string {
  const r = (c: number) => {
    const v = tempIn(units, c);
    return opts?.decimals === 1 ? round1(v) : Math.round(v);
  };
  const lo = r(minC);
  const hi = r(maxC);
  const unit = `${opts?.space ? " " : ""}${tempUnit(units)}`;
  return lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`;
}

/** "12 km/h" / "7 mph", whole numbers. */
export function formatWind(kph: number | null | undefined, units: UnitSystem): string | null {
  if (!isFiniteNumber(kph)) return null;
  return `${Math.round(windIn(units, kph))} ${windUnit(units)}`;
}

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

/**
 * How far away a track is: "5.5 km" (under a kilometre "450 m"), or on imperial "3.4 mi" (under a
 * tenth of a mile "400 ft"), the way a map app says it. A racer in San Diego on mph read
 * "Mini-RC San Diego (5.5 km)" (test drive, 2026-09-26).
 */
export function formatDistance(meters: number, units: UnitSystem): string {
  if (units === "imperial") {
    const miles = meters / METERS_PER_MILE;
    if (miles < 0.1) return `${Math.round(meters / METERS_PER_FOOT)} ft`;
    return `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * A search radius in whole units, rounded down so "No tracks within …" stays true: 25 km reads
 * "25 km", or "15 mi" (it is 15.5).
 */
export function formatRadius(meters: number, units: UnitSystem): string {
  return units === "imperial"
    ? `${Math.floor(meters / METERS_PER_MILE)} mi`
    : `${Math.floor(meters / 1000)} km`;
}

/**
 * The figure alone, at most one decimal, for an input box or a stat cell that prints its own
 * unit. "" when there is no reading. Converting back and forth leaves float dust (93.99999…),
 * which the one decimal absorbs.
 */
export function tempFigure(celsius: number | null | undefined, units: UnitSystem): string {
  return isFiniteNumber(celsius) ? String(round1(tempIn(units, celsius))) : "";
}

export function windFigure(kph: number | null | undefined, units: UnitSystem): string {
  return isFiniteNumber(kph) ? String(round1(windIn(units, kph))) : "";
}
