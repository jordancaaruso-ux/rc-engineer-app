/**
 * Air-temperature bands — the shared vocabulary for the conditions feature.
 *
 * Used two ways:
 *  - display / Engineer context (a friendly "warm" label alongside the raw °C), and
 *  - the temperature axis of CAR_PARAMETER_CONDITION setup aggregations
 *    (see `encodeTrackConditionSignature` + `rebuildCarParameterAggregations`).
 *
 * Bands are intentionally coarse (4 buckets): grip changes meaningfully across
 * them, but finer buckets would fragment already-sparse per-car run data. The
 * aggregation rebuild also always emits a temp-agnostic (`any`) bucket, so runs
 * still aggregate when a band is thin.
 *
 * Thresholds are in Celsius (canonical storage unit).
 */

export type TemperatureBand = "cool" | "mild" | "warm" | "hot";

/** Deterministic order for iteration / stable bucket emission. */
export const ALL_TEMPERATURE_BANDS: readonly TemperatureBand[] = [
  "cool",
  "mild",
  "warm",
  "hot",
] as const;

/**
 * Classify an air temperature (°C) into a band. Returns null when temp is
 * missing / non-finite so callers fall back to the temp-agnostic bucket.
 *
 * Boundaries (°C): cool < 16 ≤ mild < 23 ≤ warm < 30 ≤ hot
 */
export function temperatureBand(airTempC: number | null | undefined): TemperatureBand | null {
  if (typeof airTempC !== "number" || !Number.isFinite(airTempC)) return null;
  if (airTempC < 16) return "cool";
  if (airTempC < 23) return "mild";
  if (airTempC < 30) return "warm";
  return "hot";
}

/** Human label for UI / Engineer context (e.g. "warm (23–30°C)"). */
export function temperatureBandLabel(band: TemperatureBand): string {
  switch (band) {
    case "cool":
      return "cool (<16°C)";
    case "mild":
      return "mild (16–23°C)";
    case "warm":
      return "warm (23–30°C)";
    case "hot":
      return "hot (≥30°C)";
  }
}

/** Short label without the range, for compact chips. */
export function temperatureBandShortLabel(band: TemperatureBand): string {
  return band;
}
