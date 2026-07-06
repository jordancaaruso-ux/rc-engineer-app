/**
 * Open-Meteo weather client for run conditions.
 *
 * Open-Meteo is free and keyless. We call it server-side (see /api/weather) so
 * device/track coordinates never go to a third party from the browser, and so
 * responses can be cached.
 *
 * Endpoint selection by how far back the session was:
 *  - ≤ ~90 days  → forecast API (`past_days` window; supports date params)
 *  - >  ~90 days → historical archive API (ERA5)
 * The two windows overlap-free cover any instant; live logging (no session
 * time) uses "now" on the forecast API.
 *
 * The pure helpers (`buildOpenMeteoRequest`, `pickHourlyObservation`,
 * `floorToUtcHourIso`) are exported for offline unit testing without network.
 */
import {
  EMPTY_RUN_CONDITIONS,
  type RunConditions,
  type RunConditionsSource,
} from "@/lib/weather/conditions";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

/** Beyond this age the forecast API's past window no longer covers the date. */
export const ARCHIVE_AGE_DAYS = 90;

const HOURLY_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "cloud_cover",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
] as const;

export class WeatherFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherFetchError";
  }
}

/** ~1km precision — enough for weather, friendlier for caching + privacy. */
function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}

function utcDateStamp(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Floor an instant to its UTC hour, formatted like Open-Meteo's hourly labels. */
export function floorToUtcHourIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:00`;
}

export type OpenMeteoRequest = {
  url: string;
  kind: Extract<RunConditionsSource, "open-meteo-forecast" | "open-meteo-archive">;
  /** UTC hour label we'll match in the response's hourly.time array. */
  targetHourIso: string;
};

/** Pure: choose endpoint + build the request URL for a lat/lon at an instant. */
export function buildOpenMeteoRequest(params: {
  latitude: number;
  longitude: number;
  at: Date;
  now?: Date;
}): OpenMeteoRequest {
  const now = params.now ?? new Date();
  const at = params.at;
  const ageMs = now.getTime() - at.getTime();
  const ageDays = ageMs / 86_400_000;
  const useArchive = ageDays > ARCHIVE_AGE_DAYS;

  const dateStamp = utcDateStamp(at);
  const search = new URLSearchParams({
    latitude: String(roundCoord(params.latitude)),
    longitude: String(roundCoord(params.longitude)),
    hourly: HOURLY_FIELDS.join(","),
    start_date: dateStamp,
    end_date: dateStamp,
    timezone: "UTC",
    wind_speed_unit: "kmh",
  });

  return {
    url: `${useArchive ? ARCHIVE_URL : FORECAST_URL}?${search.toString()}`,
    kind: useArchive ? "open-meteo-archive" : "open-meteo-forecast",
    targetHourIso: floorToUtcHourIso(at),
  };
}

type OpenMeteoHourly = {
  time?: unknown;
  temperature_2m?: unknown;
  relative_humidity_2m?: unknown;
  cloud_cover?: unknown;
  weather_code?: unknown;
  wind_speed_10m?: unknown;
  wind_direction_10m?: unknown;
};

function numAt(arr: unknown, i: number): number | null {
  if (!Array.isArray(arr)) return null;
  const v = arr[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function intAt(arr: unknown, i: number): number | null {
  const v = numAt(arr, i);
  return v == null ? null : Math.round(v);
}

/** Index of the hourly entry matching `targetHourIso`, else the nearest one. */
function resolveHourIndex(times: string[], targetHourIso: string): number {
  const exact = times.indexOf(targetHourIso);
  if (exact !== -1) return exact;
  if (times.length === 0) return -1;
  const targetMs = new Date(`${targetHourIso}:00Z`).getTime();
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(`${times[i]}:00Z`).getTime();
    if (!Number.isFinite(t)) continue;
    const delta = Math.abs(t - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

/**
 * Pure: extract the observation at (or nearest) the target hour from an
 * Open-Meteo JSON body. Returns partial conditions (no source/coords).
 */
export function pickHourlyObservation(
  body: { hourly?: OpenMeteoHourly } | null | undefined,
  targetHourIso: string
): Pick<
  RunConditions,
  | "airTempC"
  | "cloudCoverPct"
  | "weatherCode"
  | "humidityPct"
  | "windKph"
  | "windDirDeg"
  | "observedAtIso"
> | null {
  const hourly = body?.hourly;
  const times = Array.isArray(hourly?.time)
    ? (hourly!.time as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  if (times.length === 0) return null;
  const i = resolveHourIndex(times, targetHourIso);
  if (i < 0) return null;
  return {
    airTempC: numAt(hourly!.temperature_2m, i),
    cloudCoverPct: intAt(hourly!.cloud_cover, i),
    weatherCode: intAt(hourly!.weather_code, i),
    humidityPct: intAt(hourly!.relative_humidity_2m, i),
    windKph: numAt(hourly!.wind_speed_10m, i),
    windDirDeg: intAt(hourly!.wind_direction_10m, i),
    observedAtIso: new Date(`${times[i]}:00Z`).toISOString(),
  };
}

export type FetchImpl = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Fetch normalized conditions for a location at an instant (default: now).
 * `opts.fetchImpl` / `opts.now` are injectable for tests.
 */
export async function fetchRunConditionsFromOpenMeteo(
  params: { latitude: number; longitude: number; atIso?: string | null },
  opts?: { fetchImpl?: FetchImpl; now?: Date }
): Promise<RunConditions> {
  const at =
    params.atIso && !Number.isNaN(new Date(params.atIso).getTime())
      ? new Date(params.atIso)
      : (opts?.now ?? new Date());

  const req = buildOpenMeteoRequest({
    latitude: params.latitude,
    longitude: params.longitude,
    at,
    now: opts?.now,
  });

  const doFetch: FetchImpl = opts?.fetchImpl ?? ((url) => fetch(url) as ReturnType<FetchImpl>);

  let res: Awaited<ReturnType<FetchImpl>>;
  try {
    res = await doFetch(req.url);
  } catch (err) {
    throw new WeatherFetchError(
      `Weather lookup failed: ${err instanceof Error ? err.message : "network error"}`
    );
  }
  if (!res.ok) {
    throw new WeatherFetchError(`Weather service returned ${res.status}.`);
  }

  const body = (await res.json()) as { hourly?: OpenMeteoHourly };
  const obs = pickHourlyObservation(body, req.targetHourIso);
  if (!obs) {
    throw new WeatherFetchError("No weather reading available for that time and place.");
  }

  return {
    ...EMPTY_RUN_CONDITIONS,
    ...obs,
    source: req.kind,
    latitude: roundCoord(params.latitude),
    longitude: roundCoord(params.longitude),
  };
}
