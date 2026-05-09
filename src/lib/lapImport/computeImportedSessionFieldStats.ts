import { getAverageTopN, getBestLap, type LapRow } from "@/lib/lapAnalysis";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";

export const IMPORTED_SESSION_FIELD_STATS_VERSION = 1 as const;

/** Per-driver row for an imported timing session (field + user's row). */
export type ImportedSessionFieldDriverStatV1 = {
  driverId: string;
  driverName: string;
  normalizedName: string;
  lapCount: number;
  bestLapSeconds: number | null;
  avgTop5Seconds: number | null;
  avgTop10Seconds: number | null;
  rankByBest: number | null;
};

export type ImportedSessionFieldStatsV1 = {
  version: typeof IMPORTED_SESSION_FIELD_STATS_VERSION;
  computedAtIso: string;
  driverCount: number;
  drivers: ImportedSessionFieldDriverStatV1[];
  field: {
    medianBestSeconds: number | null;
    medianAvgTop5Seconds: number | null;
    minBestSeconds: number | null;
  };
};

function lapRowsFromDriverLaps(nums: number[]): LapRow[] {
  return nums.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSeconds: t,
    isIncluded: true,
  }));
}

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Canonical multi-driver lap list for deriving `ImportedSessionFieldStatsV1` (same numeric rules as payloads).
 */
export type ImportedSessionDriverLapInputsV1 = {
  driverId: string;
  driverName: string;
  normalizedName: string;
  laps: number[];
};

function buildImportedSessionStatsFromDriversArray(
  raw: ImportedSessionDriverLapInputsV1[]
): ImportedSessionFieldStatsV1 | null {
  if (!raw || raw.length === 0) return null;

  const drivers: ImportedSessionFieldDriverStatV1[] = raw.map((d) => {
    const rows = lapRowsFromDriverLaps(d.laps);
    const best = getBestLap(rows);
    return {
      driverId: d.driverId,
      driverName: d.driverName,
      normalizedName: d.normalizedName,
      lapCount: d.laps.length,
      bestLapSeconds: best,
      avgTop5Seconds: getAverageTopN(rows, 5),
      avgTop10Seconds: getAverageTopN(rows, 10),
      rankByBest: null,
    };
  });

  const withBest = drivers.filter((x) => x.bestLapSeconds != null && Number.isFinite(x.bestLapSeconds));
  const bestSortedAsc = [...withBest].sort(
    (a, b) => (a.bestLapSeconds ?? Infinity) - (b.bestLapSeconds ?? Infinity)
  );
  for (let i = 0; i < bestSortedAsc.length; i++) {
    const d = drivers.find((x) => x.driverId === bestSortedAsc[i]!.driverId);
    if (d) d.rankByBest = i + 1;
  }

  const bestValues = withBest.map((x) => x.bestLapSeconds!).sort((a, b) => a - b);
  const avg5Values = drivers
    .map((x) => x.avgTop5Seconds)
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);

  return {
    version: IMPORTED_SESSION_FIELD_STATS_VERSION,
    computedAtIso: new Date().toISOString(),
    driverCount: drivers.length,
    drivers,
    field: {
      medianBestSeconds: medianSorted(bestValues),
      medianAvgTop5Seconds: medianSorted(avg5Values),
      minBestSeconds: bestValues.length > 0 ? bestValues[0]! : null,
    },
  };
}

export function computeImportedSessionFieldStatsFromDrivers(
  raw: ImportedSessionDriverLapInputsV1[]
): ImportedSessionFieldStatsV1 | null {
  const stats = buildImportedSessionStatsFromDriversArray(raw);
  return stats != null && stats.driverCount >= 2 ? stats : null;
}

/**
 * Stored JSON on `ImportedLapTimeSession` — summarizes every driver in `sessionDrivers`
 * (or single top-level laps) so Engineer / UI can compare user pace vs field without re-parsing payloads.
 */
export function computeImportedSessionFieldStatsFromPayload(parsedPayload: unknown): ImportedSessionFieldStatsV1 | null {
  const raw = rawSessionDriversFromImportedPayload(parsedPayload);
  if (!raw || raw.length === 0) return null;

  const inputs: ImportedSessionDriverLapInputsV1[] = raw.map((d: LapUrlSessionDriver) => ({
    driverId: d.driverId,
    driverName: d.driverName,
    normalizedName: d.normalizedName,
    laps: d.laps,
  }));
  return computeImportedSessionFieldStatsFromDrivers(inputs);
}

/** Narrow shape `{ sessionDrivers, laps }` matches persisted `parsedPayload`. */
function serviceShapeFromParse(parsed: LapUrlParseResult): Record<string, unknown> {
  return {
    laps: parsed.laps,
    sessionDrivers: parsed.sessionDrivers ?? [],
  };
}

export function computeImportedSessionFieldStatsFromParse(
  parsed: LapUrlParseResult
): ImportedSessionFieldStatsV1 | null {
  return computeImportedSessionFieldStatsFromPayload(serviceShapeFromParse(parsed));
}

/** Compact summary for list APIs (avoids shipping full `drivers` array). */
export type ImportedSessionFieldStatsPreviewV1 = {
  driverCount: number;
  medianBestSeconds: number | null;
};

export function importedSessionFieldStatsPreviewFromJson(
  raw: unknown
): ImportedSessionFieldStatsPreviewV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as ImportedSessionFieldStatsV1;
  if (o.version !== IMPORTED_SESSION_FIELD_STATS_VERSION) return null;
  if (typeof o.driverCount !== "number") return null;
  const med = o.field?.medianBestSeconds;
  return {
    driverCount: o.driverCount,
    medianBestSeconds: typeof med === "number" && Number.isFinite(med) ? med : null,
  };
}
