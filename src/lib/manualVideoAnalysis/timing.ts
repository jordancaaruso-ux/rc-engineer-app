import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import type { DriverRole, ManualDriver, ManualDriverLap, ManualVideoSessionV1 } from "./types";

export function driversFromParseResult(
  parsed: LapUrlParseResult,
  primaryDriverName?: string | null
): ManualDriver[] {
  const sd = parsed.sessionDrivers ?? [];
  if (sd.length === 0 && parsed.laps.length > 0) {
    return [
      {
        key: "primary",
        driverName: primaryDriverName ?? "You",
        normalizedName: "primary",
        role: "me",
        laps: parsed.laps.map((t, i) => ({
          lapNumber: i + 1,
          lapTimeSec: t,
          isIncluded: true,
        })),
      },
    ];
  }

  const normPrimary = primaryDriverName?.trim().toLowerCase() || null;
  let foundMe = false;
  return sd.map((d, idx) => {
    const laps = lapsFromSessionDriver(d);
    let role: "me" | "competitor" = "competitor";
    if (normPrimary) {
      const isMe =
        d.normalizedName.toLowerCase().includes(normPrimary) ||
        d.driverName.toLowerCase().includes(normPrimary) ||
        normPrimary.includes(d.normalizedName.toLowerCase());
      if (isMe && !foundMe) {
        role = "me";
        foundMe = true;
      }
    } else if (idx === 0) {
      role = "me";
      foundMe = true;
    }
    return {
      key: d.driverId || d.id || `d${idx}`,
      driverName: d.driverName,
      normalizedName: d.normalizedName,
      role,
      laps,
    } as ManualDriver;
  });
}

/** Pick default me/competitor keys for UI selects (always two distinct keys when possible). */
export function defaultDriverKeys(drivers: ManualDriver[]): {
  meKey: string;
  competitorKey: string;
} {
  if (drivers.length === 0) return { meKey: "", competitorKey: "" };
  const me = drivers.find((d) => d.role === "me");
  const competitor = drivers.find((d) => d.role === "competitor" && d.key !== me?.key);
  if (me && competitor) return { meKey: me.key, competitorKey: competitor.key };
  if (drivers.length >= 2) {
    return { meKey: drivers[0]!.key, competitorKey: drivers[1]!.key };
  }
  return { meKey: drivers[0]!.key, competitorKey: "" };
}

function lapsFromSessionDriver(d: LapUrlSessionDriver): ManualDriverLap[] {
  const rows = d.laps ?? [];
  return rows.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSec: t,
    isIncluded: true,
  }));
}

export function driversFromRunImportedLapSets(
  sets: Array<{
    driverId: string | null;
    driverName: string;
    normalizedName: string;
    isPrimaryUser: boolean;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }>
): ManualDriver[] {
  let hasPrimary = false;
  const drivers: ManualDriver[] = sets.map((s) => {
    const role = s.isPrimaryUser && !hasPrimary ? "me" : "competitor";
    if (role === "me") hasPrimary = true;
    return {
      key: s.driverId ?? s.normalizedName,
      driverName: s.driverName,
      normalizedName: s.normalizedName,
      role,
      laps: s.laps
        .filter((l) => l.isIncluded)
        .map((l) => ({
          lapNumber: l.lapNumber,
          lapTimeSec: l.lapTimeSeconds,
          isIncluded: true,
        })),
    };
  });
  if (!hasPrimary && drivers.length > 0) {
    drivers[0]!.role = "me";
    for (let i = 1; i < drivers.length; i++) drivers[i]!.role = "competitor";
  }
  return drivers;
}

export function setDriverRoles(
  drivers: ManualDriver[],
  meKey: string,
  competitorKey: string
): ManualDriver[] {
  return drivers.map((d) => ({
    ...d,
    role: d.key === meKey ? "me" : d.key === competitorKey ? "competitor" : d.role,
  }));
}

export function pickBestNLapNumbers(laps: ManualDriverLap[], n = 3): number[] {
  return [...laps]
    .filter((l) => l.isIncluded !== false && l.lapTimeSec > 0)
    .sort((a, b) => a.lapTimeSec - b.lapTimeSec)
    .slice(0, n)
    .map((l) => l.lapNumber);
}

/** Default isIncluded true; selectedLaps = best 3 included laps per driver. */
export function normalizeManualSession(session: ManualVideoSessionV1): ManualVideoSessionV1 {
  const drivers = session.drivers.map((d) => ({
    ...d,
    laps: d.laps.map((l) => ({
      ...l,
      isIncluded: l.isIncluded !== false,
    })),
  }));
  return applyTop3LapSelection({ ...session, drivers });
}

/** Top 3 fastest included laps per driver (working set for sync / marking). */
export function applyTop3LapSelection(session: ManualVideoSessionV1): ManualVideoSessionV1 {
  const me = session.drivers.find((d) => d.role === "me");
  const comp = session.drivers.find((d) => d.role === "competitor");
  return {
    ...session,
    selectedLaps: {
      me: me ? pickBestNLapNumbers(me.laps, 3) : [],
      competitor: comp ? pickBestNLapNumbers(comp.laps, 3) : [],
    },
  };
}

/** @deprecated Use applyTop3LapSelection */
export const applyDefaultLapSelection = applyTop3LapSelection;
export const applyBest3Selection = applyTop3LapSelection;

export function setLapIncluded(
  session: ManualVideoSessionV1,
  role: DriverRole,
  lapNumber: number,
  included: boolean
): ManualVideoSessionV1 {
  const drivers = session.drivers.map((d) => {
    if (d.role !== role) return d;
    return {
      ...d,
      laps: d.laps.map((l) =>
        l.lapNumber === lapNumber ? { ...l, isIncluded: included } : l
      ),
    };
  });
  return applyTop3LapSelection({ ...session, drivers });
}

export function bestIncludedLapNumbers(
  session: ManualVideoSessionV1,
  role: DriverRole,
  n = 3
): number[] {
  const driver = session.drivers.find((d) => d.role === role);
  if (!driver) return [];
  return pickBestNLapNumbers(driver.laps, n);
}
