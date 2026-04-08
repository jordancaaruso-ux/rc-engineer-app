import type { LapRow } from "@/lib/lapAnalysis";

/**
 * Primary lap series from stored parsedPayload (first driver with laps, else top-level laps).
 */
export function primaryLapRowsFromImportedPayload(parsed: unknown): { driverName: string; rows: LapRow[] } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const sessionDrivers = o.sessionDrivers;
  if (Array.isArray(sessionDrivers) && sessionDrivers.length > 0) {
    for (const raw of sessionDrivers) {
      if (!raw || typeof raw !== "object") continue;
      const d = raw as { driverName?: string; laps?: unknown };
      if (!Array.isArray(d.laps) || d.laps.length === 0) continue;
      const nums = d.laps.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
      if (nums.length === 0) continue;
      const rows: LapRow[] = nums.map((t, i) => ({
        lapNumber: i + 1,
        lapTimeSeconds: t,
        isIncluded: true,
      }));
      return { driverName: typeof d.driverName === "string" && d.driverName.trim() ? d.driverName.trim() : "Driver", rows };
    }
  }
  const laps = o.laps;
  if (Array.isArray(laps) && laps.length > 0) {
    const nums = laps.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (nums.length === 0) return null;
    const rows: LapRow[] = nums.map((t, i) => ({
      lapNumber: i + 1,
      lapTimeSeconds: t,
      isIncluded: true,
    }));
    return { driverName: "Practice", rows };
  }
  return null;
}
