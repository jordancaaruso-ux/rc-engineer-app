/**
 * Bridge between the `RunConditions` value object (UI / API / Engineer) and the
 * flat `conditions*` columns persisted on `Run`.
 *
 *  - `runConditionsFromRecord` — DB row → `RunConditions` (edit form, display, Engineer context).
 *  - `normalizeRunConditionsInput` — untrusted client body → clamped column values (runs API).
 *
 * Pure; no Prisma import, so it's usable on both client and server.
 */
import {
  isConditionsEmpty,
  type RunConditions,
  type RunConditionsSource,
} from "@/lib/weather/conditions";
import { isValidLatitude, isValidLongitude } from "@/lib/location/coordinates";

/** The `conditions*` scalar columns on `Run`, as read from Prisma. */
export type RunConditionsRecord = {
  conditionsAirTempC: number | null;
  conditionsTrackTempC: number | null;
  conditionsCloudCoverPct: number | null;
  conditionsWeatherCode: number | null;
  conditionsHumidityPct: number | null;
  conditionsWindKph: number | null;
  conditionsWindDirDeg: number | null;
  conditionsSource: string | null;
  conditionsLatitude: number | null;
  conditionsLongitude: number | null;
  conditionsObservedAt: Date | string | null;
};

const KNOWN_SOURCES: readonly RunConditionsSource[] = [
  "open-meteo-forecast",
  "open-meteo-archive",
  "manual",
];

export function runConditionsFromRecord(
  r: Partial<RunConditionsRecord> | null | undefined
): RunConditions {
  const observed =
    r?.conditionsObservedAt instanceof Date
      ? r.conditionsObservedAt.toISOString()
      : typeof r?.conditionsObservedAt === "string"
        ? r.conditionsObservedAt
        : null;
  return {
    airTempC: r?.conditionsAirTempC ?? null,
    trackTempC: r?.conditionsTrackTempC ?? null,
    cloudCoverPct: r?.conditionsCloudCoverPct ?? null,
    weatherCode: r?.conditionsWeatherCode ?? null,
    humidityPct: r?.conditionsHumidityPct ?? null,
    windKph: r?.conditionsWindKph ?? null,
    windDirDeg: r?.conditionsWindDirDeg ?? null,
    source: (r?.conditionsSource as RunConditionsSource | null) ?? null,
    latitude: r?.conditionsLatitude ?? null,
    longitude: r?.conditionsLongitude ?? null,
    observedAtIso: observed,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clampNum(v: unknown, min: number, max: number): number | null {
  const n = numOrNull(v);
  if (n == null) return null;
  return Math.min(max, Math.max(min, n));
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = clampNum(v, min, max);
  return n == null ? null : Math.round(n);
}

/**
 * Validate + clamp an untrusted `conditions` body into DB column values.
 * Returns null when the reading is effectively empty (nothing worth storing).
 * When any weather value is present but no source was supplied, stamps `manual`.
 */
export function normalizeRunConditionsInput(input: unknown): RunConditionsRecord | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;

  const lat = numOrNull(c.latitude);
  const lon = numOrNull(c.longitude);
  const observedRaw = typeof c.observedAtIso === "string" ? c.observedAtIso : null;
  const observedAt =
    observedRaw && !Number.isNaN(new Date(observedRaw).getTime())
      ? new Date(observedRaw)
      : null;

  const sourceRaw = typeof c.source === "string" ? c.source : null;
  const normalizedInput: RunConditions = {
    airTempC: clampNum(c.airTempC, -60, 80),
    trackTempC: clampNum(c.trackTempC, -60, 100),
    cloudCoverPct: clampInt(c.cloudCoverPct, 0, 100),
    weatherCode: clampInt(c.weatherCode, 0, 99),
    humidityPct: clampInt(c.humidityPct, 0, 100),
    windKph: clampNum(c.windKph, 0, 500),
    windDirDeg: clampInt(c.windDirDeg, 0, 360),
    source: null,
    latitude: lat != null && isValidLatitude(lat) ? lat : null,
    longitude: lon != null && isValidLongitude(lon) ? lon : null,
    observedAtIso: observedAt ? observedAt.toISOString() : null,
  };

  if (isConditionsEmpty(normalizedInput)) return null;

  const source: RunConditionsSource =
    sourceRaw && (KNOWN_SOURCES as readonly string[]).includes(sourceRaw)
      ? (sourceRaw as RunConditionsSource)
      : "manual";

  return {
    conditionsAirTempC: normalizedInput.airTempC,
    conditionsTrackTempC: normalizedInput.trackTempC,
    conditionsCloudCoverPct: normalizedInput.cloudCoverPct,
    conditionsWeatherCode: normalizedInput.weatherCode,
    conditionsHumidityPct: normalizedInput.humidityPct,
    conditionsWindKph: normalizedInput.windKph,
    conditionsWindDirDeg: normalizedInput.windDirDeg,
    conditionsSource: source,
    conditionsLatitude: normalizedInput.latitude,
    conditionsLongitude: normalizedInput.longitude,
    conditionsObservedAt: observedAt,
  };
}

/** All conditions columns set to null — for clearing on update when body sends empty. */
export const NULL_RUN_CONDITIONS_COLUMNS: RunConditionsRecord = {
  conditionsAirTempC: null,
  conditionsTrackTempC: null,
  conditionsCloudCoverPct: null,
  conditionsWeatherCode: null,
  conditionsHumidityPct: null,
  conditionsWindKph: null,
  conditionsWindDirDeg: null,
  conditionsSource: null,
  conditionsLatitude: null,
  conditionsLongitude: null,
  conditionsObservedAt: null,
};
