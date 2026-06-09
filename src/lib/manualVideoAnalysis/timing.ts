import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import type {
  DriverRole,
  ManualDriver,
  ManualDriverLap,
  ManualTimingSession,
  ManualVideoSessionV2,
} from "./types";
import { newTimingSessionId } from "./types";

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
    let role: DriverRole = "competitor";
    if (normPrimary) {
      const isMe =
        d.normalizedName.toLowerCase() === normPrimary ||
        d.driverName.toLowerCase() === normPrimary ||
        d.normalizedName.toLowerCase().includes(normPrimary) ||
        d.driverName.toLowerCase().includes(normPrimary);
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

export function timingSessionFromParseResult(
  parsed: LapUrlParseResult,
  sourceUrl: string,
  primaryDriverName?: string | null,
  label?: string
): ManualTimingSession {
  const drivers = driversFromParseResult(parsed, primaryDriverName);
  return {
    sessionId: newTimingSessionId(),
    label: label ?? sessionLabelFromUrl(sourceUrl),
    sourceUrl,
    isOnVideo: true,
    drivers,
    sync: {},
  };
}

export function sessionLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split("/").filter(Boolean).slice(-2).join("/");
    return path || u.hostname;
  } catch {
    return url.slice(0, 40);
  }
}

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
    sourceUrl?: string | null;
    sessionCompletedAt?: Date | string | null;
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

export function timingSessionsFromRunImportedLapSets(
  sets: Array<{
    sourceUrl?: string | null;
    sessionCompletedAt?: Date | string | null;
    driverId: string | null;
    driverName: string;
    normalizedName: string;
    isPrimaryUser: boolean;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }>
): ManualTimingSession[] {
  const byUrl = new Map<string, typeof sets>();
  for (const s of sets) {
    const key = (s.sourceUrl?.trim() || "run") + (s.sessionCompletedAt?.toString() ?? "");
    const list = byUrl.get(key) ?? [];
    list.push(s);
    byUrl.set(key, list);
  }

  return [...byUrl.entries()].map(([key, group]) => {
    const first = group[0]!;
    const completed =
      first.sessionCompletedAt instanceof Date
        ? first.sessionCompletedAt.toISOString()
        : typeof first.sessionCompletedAt === "string"
          ? first.sessionCompletedAt
          : null;
    return {
      sessionId: newTimingSessionId(),
      label: first.sourceUrl ? sessionLabelFromUrl(first.sourceUrl) : "Run session",
      sourceUrl: first.sourceUrl ?? null,
      sessionCompletedAtIso: completed,
      isOnVideo: true,
      drivers: driversFromRunImportedLapSets(group),
      sync: {},
    };
  });
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

export function allIncludedLapNumbers(laps: ManualDriverLap[]): number[] {
  return [...laps]
    .filter((l) => l.isIncluded !== false && l.lapTimeSec > 0)
    .sort((a, b) => a.lapNumber - b.lapNumber)
    .map((l) => l.lapNumber);
}

export function normalizeManualSession(session: ManualVideoSessionV2): ManualVideoSessionV2 {
  const timingSessions = session.timingSessions.map((ts) => ({
    ...ts,
    drivers: ts.drivers.map((d) => ({
      ...d,
      laps: d.laps.map((l) => ({ ...l, isIncluded: l.isIncluded !== false })),
    })),
  }));
  return applyTop3LapSelection({ ...session, timingSessions });
}

export function applyTop3LapSelection(session: ManualVideoSessionV2): ManualVideoSessionV2 {
  const primary = session.timingSessions.find((s) => s.isOnVideo) ?? session.timingSessions[0];
  const me = primary?.drivers.find((d) => d.role === "me");
  const comp = primary?.drivers.find((d) => d.role === "competitor");
  return {
    ...session,
    selectedLaps: {
      me: me ? pickBestNLapNumbers(me.laps, 3) : [],
      competitor: comp ? pickBestNLapNumbers(comp.laps, 3) : [],
    },
  };
}

export const applyDefaultLapSelection = applyTop3LapSelection;
export const applyBest3Selection = applyTop3LapSelection;

export function setLapIncluded(
  session: ManualVideoSessionV2,
  sessionId: string,
  role: DriverRole,
  lapNumber: number,
  included: boolean
): ManualVideoSessionV2 {
  const timingSessions = session.timingSessions.map((ts) => {
    if (ts.sessionId !== sessionId) return ts;
    return {
      ...ts,
      drivers: ts.drivers.map((d) => {
        if (d.role !== role) return d;
        return {
          ...d,
          laps: d.laps.map((l) =>
            l.lapNumber === lapNumber ? { ...l, isIncluded: included } : l
          ),
        };
      }),
    };
  });
  return applyTop3LapSelection({ ...session, timingSessions });
}

export function bestIncludedLapNumbers(
  session: ManualVideoSessionV2,
  sessionId: string,
  role: DriverRole,
  n = 3
): number[] {
  const ts = session.timingSessions.find((s) => s.sessionId === sessionId);
  const driver = ts?.drivers.find((d) => d.role === role);
  if (!driver) return [];
  return pickBestNLapNumbers(driver.laps, n);
}
