import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { realLaps } from "@/lib/videoAnalysis/findCrossings/fromSession";
import type {
  DriverRole,
  DriverSlot,
  ManualDriver,
  ManualDriverLap,
  ManualTimingSession,
  ManualVideoSessionV2,
} from "./types";
import { newTimingSessionId } from "./types";
import { parseViewCropNorm } from "./videoViewCrop";

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
    // Everyone in the imported heat starts as nobody. Defaulting them to "competitor" here is what
    // put fifteen drivers in a slot meant for one, and made the rival a matter of list order.
    let role: DriverSlot = "other";
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

/** LiveRC practice pages reuse the same parser driver id — scope keys per timing session. */
export function namespaceSessionDriverKeys(
  sessionId: string,
  drivers: ManualDriver[]
): ManualDriver[] {
  return drivers.map((d) => ({
    ...d,
    key: `${sessionId}::${d.key}`,
  }));
}

export function timingSessionFromParseResult(
  parsed: LapUrlParseResult,
  sourceUrl: string,
  primaryDriverName?: string | null,
  label?: string
): ManualTimingSession {
  const sessionId = newTimingSessionId();
  const drivers = namespaceSessionDriverKeys(
    sessionId,
    driversFromParseResult(parsed, primaryDriverName)
  );
  return {
    sessionId,
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

/**
 * Who this analysis is about, before the driver has said.
 *
 * "Me" is a real match — the driver's saved timing name against the field — but the rival never
 * was. A heat import brings fifteen drivers and this used to hand back whichever one the timing
 * site listed first, which then became the car every sector time was measured against without
 * anybody choosing it. A rival is now only ever returned when it is genuinely known: either the
 * driver has already picked one, or the session holds exactly two people and there is nothing
 * to pick between.
 */
export function defaultDriverKeys(drivers: ManualDriver[]): {
  meKey: string;
  competitorKey: string;
} {
  if (drivers.length === 0) return { meKey: "", competitorKey: "" };
  const me = drivers.find((d) => d.role === "me");
  const competitor = drivers.find((d) => d.role === "competitor" && d.key !== me?.key);
  if (me) return { meKey: me.key, competitorKey: competitor?.key ?? "" };
  // Two people and no name match: there is nothing to pick between, so position decides both.
  if (drivers.length === 2) return { meKey: drivers[0]!.key, competitorKey: drivers[1]!.key };
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
    const sessionId = newTimingSessionId();
    const completed =
      first.sessionCompletedAt instanceof Date
        ? first.sessionCompletedAt.toISOString()
        : typeof first.sessionCompletedAt === "string"
          ? first.sessionCompletedAt
          : null;
    return {
      sessionId,
      label: first.sourceUrl ? sessionLabelFromUrl(first.sourceUrl) : "Run session",
      sourceUrl: first.sourceUrl ?? null,
      sessionCompletedAtIso: completed,
      isOnVideo: true,
      drivers: namespaceSessionDriverKeys(sessionId, driversFromRunImportedLapSets(group)),
      sync: {},
    };
  });
}

/** Multi-URL practice: only the session with "me" is on this video by default. */
export function applyDefaultIsOnVideo(sessions: ManualTimingSession[]): ManualTimingSession[] {
  let placedMeOnVideo = false;
  return sessions.map((ts) => {
    const hasMe = ts.drivers.some((d) => d.role === "me");
    const onVideo = hasMe && !placedMeOnVideo;
    if (onVideo) placedMeOnVideo = true;
    return { ...ts, isOnVideo: onVideo };
  });
}

/**
 * Stamp the two chosen drivers and demote everybody else.
 *
 * Keeping an unlisted driver's previous role is what let a whole field read as the competitor:
 * "competitor" was the default role on every imported row, so every one of them answered to a
 * lookup for the rival and the first in the list won. Exactly one driver holds each slot now.
 */
export function setDriverRoles(
  drivers: ManualDriver[],
  meKey: string,
  competitorKey: string
): ManualDriver[] {
  return drivers.map((d) => ({
    ...d,
    role: d.key === meKey ? "me" : d.key && d.key === competitorKey ? "competitor" : "other",
  }));
}

export function pickBestNLapNumbers(laps: ManualDriverLap[], n = 3): number[] {
  // realLaps first: a race's opening lap is timed from the start line, so it is a fragment, and
  // sorting by lap time would otherwise offer it as the driver's best lap.
  return realLaps([...laps])
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

/**
 * One driver per slot, whatever the stored session says.
 *
 * Sessions saved before "other" existed have the entire imported field sitting in the rival's
 * slot, so a lookup for the competitor answers with whoever the timing site listed first. Read
 * back through here they keep that same first driver — no silent change of who the analysis is
 * about — and everyone else steps out of the way so the picker can show the truth.
 */
function oneDriverPerSlot(drivers: ManualDriver[]): ManualDriver[] {
  const meKey = drivers.find((d) => d.role === "me")?.key;
  const rivalKey = drivers.find((d) => d.role === "competitor" && d.key !== meKey)?.key;
  return drivers.map((d) => ({
    ...d,
    role: d.key === meKey ? "me" : d.key === rivalKey ? "competitor" : "other",
  }));
}

export function normalizeManualSession(session: ManualVideoSessionV2): ManualVideoSessionV2 {
  const timingSessions = session.timingSessions.map((ts) => ({
    ...ts,
    drivers: oneDriverPerSlot(ts.drivers).map((d) => ({
      ...d,
      laps: d.laps.map((l) => ({ ...l, isIncluded: l.isIncluded !== false })),
    })),
  }));
  const viewCropNorm = session.viewCropNorm ? parseViewCropNorm(session.viewCropNorm) : undefined;
  return applyTop3LapSelection({
    ...session,
    timingSessions,
    ...(viewCropNorm ? { viewCropNorm } : { viewCropNorm: undefined }),
  });
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
