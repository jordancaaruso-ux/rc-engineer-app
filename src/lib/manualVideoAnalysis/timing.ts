import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import type { ManualDriver, ManualDriverLap, ManualVideoSessionV1 } from "./types";

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

  const normPrimary = primaryDriverName?.trim().toLowerCase();
  return sd.map((d, idx) => {
    const laps = lapsFromSessionDriver(d);
    const isMe =
      normPrimary != null &&
      (d.normalizedName.toLowerCase().includes(normPrimary) ||
        d.driverName.toLowerCase().includes(normPrimary) ||
        normPrimary.includes(d.normalizedName.toLowerCase()));
    return {
      key: d.driverId || d.id || `d${idx}`,
      driverName: d.driverName,
      normalizedName: d.normalizedName,
      role: isMe ? "me" : "competitor",
      laps,
    } as ManualDriver;
  });
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

export function applyBest3Selection(session: ManualVideoSessionV1): ManualVideoSessionV1 {
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
