import type { LapRow } from "@/lib/lapAnalysis";
import type { LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { pickPrimarySessionDriver } from "@/lib/lapImport/pickPrimarySessionDriver";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

function lapRowsFromNums(nums: number[]): LapRow[] {
  return nums.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSeconds: t,
    isIncluded: true,
  }));
}

/**
 * Build URL-import driver list + selection for Log your run from stored `parsedPayload`.
 * Practice: optionally restrict to the user’s LiveRC driver. Race: full field, preselect user row.
 */
export function buildImportedIngestPlanFromPayload(
  parsed: unknown,
  opts: {
    mode: "practice_user_only" | "race_full_field";
    liveRcDriverName: string | null;
    /** When stored payload uses LiveRC driver ids (race imports); optional for legacy rows. */
    liveRcDriverId?: string | null;
  }
): {
  sessionDrivers: LapUrlSessionDriver[];
  selectedDriverIds: string[];
  primaryDriverName: string;
  primaryRows: LapRow[];
} | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const sessionDriversRaw = o.sessionDrivers;
  const outDrivers: LapUrlSessionDriver[] = [];

  if (Array.isArray(sessionDriversRaw) && sessionDriversRaw.length > 0) {
    let idx = 0;
    for (const raw of sessionDriversRaw) {
      if (!raw || typeof raw !== "object") continue;
      const d = raw as { driverName?: string; laps?: unknown };
      if (!Array.isArray(d.laps) || d.laps.length === 0) continue;
      const nums = d.laps.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
      if (nums.length === 0) continue;
      const driverName = typeof d.driverName === "string" && d.driverName.trim() ? d.driverName.trim() : "Driver";
      const id = `sd-${idx}`;
      idx++;
      outDrivers.push({
        id,
        driverId: id,
        driverName,
        normalizedName: driverName.toLowerCase(),
        laps: nums,
        lapCount: nums.length,
      });
    }
  }

  const topLaps = o.laps;
  if (outDrivers.length === 0 && Array.isArray(topLaps) && topLaps.length > 0) {
    const nums = topLaps.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (nums.length > 0) {
      outDrivers.push({
        id: "sd-0",
        driverId: "sd-0",
        driverName: "Practice",
        normalizedName: "practice",
        laps: nums,
        lapCount: nums.length,
      });
    }
  }

  if (outDrivers.length === 0) return null;

  const wantNorm = opts.liveRcDriverName?.trim()
    ? normalizeLiveRcDriverNameForMatch(opts.liveRcDriverName.trim())
    : "";

  let working = outDrivers;
  if (opts.mode === "practice_user_only" && wantNorm) {
    const matched = outDrivers.filter((d) => normalizeLiveRcDriverNameForMatch(d.driverName) === wantNorm);
    if (matched.length > 0) working = matched;
    else if (outDrivers.length === 1 && outDrivers[0]!.driverName === "Practice") {
      working = outDrivers;
    }
  }

  const sessionDrivers = opts.mode === "race_full_field" ? outDrivers : working;

  let primary: (typeof outDrivers)[number];
  if (opts.mode === "race_full_field") {
    primary = pickPrimarySessionDriver(outDrivers, {
      liveRcDriverId: opts.liveRcDriverId ?? null,
      liveRcDriverName: opts.liveRcDriverName ?? null,
    });
  } else {
    primary = working[0]!;
  }

  const nums = primary.laps;
  /** Race: only the user's row is selected for editing; full field still lives in `sessionDrivers` for persistence. */
  const selectedDriverIds = [primary.driverId];

  return {
    sessionDrivers,
    selectedDriverIds,
    primaryDriverName: primary.driverName,
    primaryRows: lapRowsFromNums(nums),
  };
}
