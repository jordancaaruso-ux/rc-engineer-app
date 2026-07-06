/**
 * Normalized run conditions shape + human labels.
 *
 * This is the single canonical representation shared by the weather client,
 * the /api/weather route, the run-save API, the run form, and Engineer context.
 * All values are canonical metric (°C, %, km/h) and every field is nullable —
 * indoor runs and drafts routinely carry a partial reading (e.g. a manual air
 * temp with no sky), and pre-feature runs carry none.
 */

export type RunConditionsSource =
  | "open-meteo-forecast"
  | "open-meteo-archive"
  | "manual";

export type RunConditions = {
  airTempC: number | null;
  /** Manual probe reading; never produced by the weather API. */
  trackTempC: number | null;
  cloudCoverPct: number | null;
  /** WMO weather interpretation code (0 clear … 3 overcast … 95 thunderstorm). */
  weatherCode: number | null;
  humidityPct: number | null;
  windKph: number | null;
  windDirDeg: number | null;
  source: RunConditionsSource | null;
  latitude: number | null;
  longitude: number | null;
  /** Instant the reading represents (hour bucket at the session time), ISO string. */
  observedAtIso: string | null;
};

/** An empty reading — the starting point before a fetch or manual entry. */
export const EMPTY_RUN_CONDITIONS: RunConditions = {
  airTempC: null,
  trackTempC: null,
  cloudCoverPct: null,
  weatherCode: null,
  humidityPct: null,
  windKph: null,
  windDirDeg: null,
  source: null,
  latitude: null,
  longitude: null,
  observedAtIso: null,
};

/** True when the reading has nothing worth storing/showing. */
export function isConditionsEmpty(c: RunConditions | null | undefined): boolean {
  if (!c) return true;
  return (
    c.airTempC == null &&
    c.trackTempC == null &&
    c.cloudCoverPct == null &&
    c.weatherCode == null &&
    c.humidityPct == null &&
    c.windKph == null
  );
}

export type SkyDescription = {
  label: string;
  /** Wet track — precipitation in the reading. Drives grip caveats. */
  wet: boolean;
};

/**
 * WMO weather-code → friendly sky label. Codes are the standard Open-Meteo set.
 * We keep the RC-relevant distinctions (sun vs cloud, and "is it wet") and
 * collapse the long tail.
 */
export function skyLabelFromWeatherCode(code: number): SkyDescription {
  if (code === 0) return { label: "Sunny", wet: false };
  if (code === 1) return { label: "Mostly sunny", wet: false };
  if (code === 2) return { label: "Partly cloudy", wet: false };
  if (code === 3) return { label: "Overcast", wet: false };
  if (code === 45 || code === 48) return { label: "Fog", wet: true };
  if (code >= 51 && code <= 57) return { label: "Drizzle", wet: true };
  if (code >= 61 && code <= 67) return { label: "Rain", wet: true };
  if (code >= 71 && code <= 77) return { label: "Snow", wet: true };
  if (code >= 80 && code <= 82) return { label: "Rain showers", wet: true };
  if (code >= 85 && code <= 86) return { label: "Snow showers", wet: true };
  if (code >= 95) return { label: "Thunderstorm", wet: true };
  return { label: "Cloudy", wet: false };
}

/** Fallback sky label from cloud-cover % when no weather code is present. */
export function skyLabelFromCloudCover(cloudCoverPct: number): string {
  if (cloudCoverPct < 12) return "Sunny";
  if (cloudCoverPct < 40) return "Mostly sunny";
  if (cloudCoverPct < 70) return "Partly cloudy";
  if (cloudCoverPct < 90) return "Mostly cloudy";
  return "Overcast";
}

/**
 * Best available sky label: prefer the weather code (captures precipitation),
 * fall back to cloud-cover %, else null.
 */
export function describeSky(
  weatherCode: number | null | undefined,
  cloudCoverPct: number | null | undefined
): SkyDescription | null {
  if (typeof weatherCode === "number" && Number.isFinite(weatherCode)) {
    return skyLabelFromWeatherCode(weatherCode);
  }
  if (typeof cloudCoverPct === "number" && Number.isFinite(cloudCoverPct)) {
    return { label: skyLabelFromCloudCover(cloudCoverPct), wet: false };
  }
  return null;
}

/** Round a temperature to a whole degree for display. */
export function formatTempC(tempC: number | null | undefined): string | null {
  if (typeof tempC !== "number" || !Number.isFinite(tempC)) return null;
  return `${Math.round(tempC)}°C`;
}

/**
 * Compact one-line summary for chips / list rows, e.g. "18°C · Sunny".
 * Returns null when there's nothing to show.
 */
export function formatConditionsSummary(c: RunConditions | null | undefined): string | null {
  if (isConditionsEmpty(c)) return null;
  const parts: string[] = [];
  const temp = formatTempC(c!.airTempC);
  if (temp) parts.push(temp);
  const sky = describeSky(c!.weatherCode, c!.cloudCoverPct);
  if (sky) parts.push(sky.label);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Chip form: a short `value` (air temp, else sky) plus a fuller `title`
 * (sky, humidity, wind, track temp) for a tooltip. Null when empty.
 */
export function formatConditionsChip(
  c: RunConditions | null | undefined
): { value: string; title: string } | null {
  if (isConditionsEmpty(c)) return null;
  const temp = formatTempC(c!.airTempC);
  const sky = describeSky(c!.weatherCode, c!.cloudCoverPct);
  const value = temp ?? sky?.label ?? "—";
  const titleParts: string[] = [];
  if (temp) titleParts.push(`Air ${temp}`);
  if (sky) titleParts.push(sky.label);
  if (c!.humidityPct != null) titleParts.push(`${c!.humidityPct}% humidity`);
  if (c!.windKph != null) titleParts.push(`${Math.round(c!.windKph)} km/h wind`);
  if (c!.trackTempC != null) titleParts.push(`track ${Math.round(c!.trackTempC)}°C`);
  return { value, title: titleParts.join(" · ") };
}
