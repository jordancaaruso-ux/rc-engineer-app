import type {
  AnchorKind,
  DriverRole,
  DriverSlot,
  ManualDriver,
  ManualSessionSync,
  ManualSyncAnchor,
  ManualTimingSession,
} from "./types";
import { lapSfKey } from "./types";
import { realLaps } from "@/lib/videoAnalysis/findCrossings/fromSession";

function lapTimeMap(driver: ManualDriver): Map<number, number> {
  return new Map(driver.laps.map((l) => [l.lapNumber, l.lapTimeSec]));
}

function orderedLaps(driver: ManualDriver): ManualDriver["laps"] {
  return [...driver.laps].sort((a, b) => a.lapNumber - b.lapNumber);
}

/** One moment a driver can actually see: their car going over the start/finish line. */
export type VisibleCrossing = {
  /** 1 = the first time this car passes the line in this timing session. */
  index: number;
  anchorKind: AnchorKind;
  lapNumber: number;
  /** The lap this crossing closes, when it closes one. */
  endsLap: number | null;
  /** The lap this crossing opens, when it opens one. */
  startsLap: number | null;
};

/**
 * Every time the driver's car goes over the start/finish line, in order.
 *
 * The Sync step used to ask for "L1 start". Any driver scrubs to their car going over the line —
 * but in a race the transponder's lap 1 starts at the TONE, and the car's first time over the loop
 * is the END of lap 1. Every lap start in the app was then late by that first lap, for every
 * driver, and the start/finish window read the wrong car all afternoon. The tone is not on the
 * video, so the app must never ask for it: it asks which crossing the driver is looking at and
 * works the lap out from the timing.
 *
 * Which lap a crossing belongs to depends on how lap 1 was timed. A race lap 1 is the fragment
 * from the tone to the loop, so the first crossing ends it. A practice lap 1 is timed loop to
 * loop, so the first crossing starts it. `realLaps` already tells the two apart.
 */
export function visibleCrossings(driver: ManualDriver): VisibleCrossing[] {
  const laps = orderedLaps(driver).filter((l) => l.lapTimeSec > 0);
  if (laps.length === 0) return [];
  const first = laps[0]!;
  const firstIsFragment = !realLaps(laps).some((l) => l.lapNumber === first.lapNumber);
  if (firstIsFragment) {
    return laps.map((l, i) => ({
      index: i + 1,
      anchorKind: "sf_finish" as const,
      lapNumber: l.lapNumber,
      endsLap: l.lapNumber,
      startsLap: laps[i + 1]?.lapNumber ?? null,
    }));
  }
  const last = laps[laps.length - 1]!;
  return [
    ...laps.map((l, i) => ({
      index: i + 1,
      anchorKind: "sf_start" as const,
      lapNumber: l.lapNumber,
      endsLap: laps[i - 1]?.lapNumber ?? null,
      startsLap: l.lapNumber,
    })),
    {
      index: laps.length + 1,
      anchorKind: "sf_finish" as const,
      lapNumber: last.lapNumber,
      endsLap: last.lapNumber,
      startsLap: null,
    },
  ];
}

/** Transponder-only: seconds from session start to SF at end of lapNumber. */
export function transponderSfEndSec(
  driver: ManualDriver,
  lapNumber: number
): number | null {
  if (!driver.laps.some((l) => l.lapNumber === lapNumber)) return null;
  let sum = 0;
  for (const l of orderedLaps(driver)) {
    if (l.lapNumber > lapNumber) break;
    if (l.lapTimeSec <= 0) return null;
    sum += l.lapTimeSec;
  }
  return sum;
}

/** Transponder-only: seconds from session start to SF at start of lapNumber. */
export function transponderSfStartSec(
  driver: ManualDriver,
  lapNumber: number
): number | null {
  if (!driver.laps.some((l) => l.lapNumber === lapNumber)) return null;
  let sum = 0;
  for (const l of orderedLaps(driver)) {
    if (l.lapNumber >= lapNumber) break;
    if (l.lapTimeSec <= 0) return null;
    sum += l.lapTimeSec;
  }
  return sum;
}

export function transponderSfSec(
  driver: ManualDriver,
  lapNumber: number,
  kind: AnchorKind
): number | null {
  return kind === "sf_finish"
    ? transponderSfEndSec(driver, lapNumber)
    : transponderSfStartSec(driver, lapNumber);
}

/**
 * The anchor that places THIS driver.
 *
 * Their own, when they have one — that is exact, because the walk then runs on their own lap times
 * from a moment they were actually seen. Otherwise the session's shared anchor, which is right in
 * a race and an assumption anywhere else.
 */
export function anchorForRole(
  sync: ManualSessionSync,
  role: DriverSlot
): ManualSyncAnchor | undefined {
  if (role !== "other") {
    const own = sync.anchorByRole?.[role];
    if (own) return own;
  }
  return sync.anchor;
}

/** True when this driver is placed by their own anchor rather than by a shared start. */
export function hasOwnAnchor(sync: ManualSessionSync, role: DriverSlot): boolean {
  return role !== "other" && Boolean(sync.anchorByRole?.[role]);
}

function anchorBaseTime(sync: ManualSessionSync, anchor?: ManualSyncAnchor): number | null {
  if (!anchor) return null;
  return anchor.videoTimeSec + (sync.globalOffsetSec ?? 0);
}

/** Same-heat shortcut: at anchor lap, all drivers share SF time for finish or start anchor. */
function sameHeatTimeAtAnchorLap(
  driver: ManualDriver,
  lapNumber: number,
  sync: ManualSessionSync,
  kind: "start" | "end"
): number | null {
  const anchor = anchorForRole(sync, driver.role);
  const base = anchorBaseTime(sync, anchor);
  if (!anchor || base == null) return null;
  if (lapNumber !== anchor.lapNumber) return null;

  const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
  if (!lap) return null;

  if (anchor.anchorKind === "sf_finish" && kind === "end") return base;
  if (anchor.anchorKind === "sf_start" && kind === "start") return base;
  if (anchor.anchorKind === "sf_finish" && kind === "start") {
    return base - lap.lapTimeSec;
  }
  if (anchor.anchorKind === "sf_start" && kind === "end") {
    return base + lap.lapTimeSec;
  }
  return null;
}

function walkFromAnchorFinish(
  driver: ManualDriver,
  lapNumber: number,
  sync: ManualSessionSync
): number | null {
  const anchor = anchorForRole(sync, driver.role);
  const base = anchorBaseTime(sync, anchor);
  if (!anchor || base == null || anchor.anchorKind !== "sf_finish") return null;

  const lapMap = lapTimeMap(driver);
  const anchorLap = anchor.lapNumber;
  if (!lapMap.has(lapNumber)) return null;

  const same = sameHeatTimeAtAnchorLap(driver, lapNumber, sync, "end");
  if (same != null) return same;

  if (!lapMap.has(anchorLap)) return null;

  if (lapNumber > anchorLap) {
    let t = base;
    for (let n = anchorLap + 1; n <= lapNumber; n++) {
      const dt = lapMap.get(n);
      if (dt == null) return null;
      t += dt;
    }
    return t;
  }

  let t = base;
  for (let n = anchorLap; n > lapNumber; n--) {
    const dt = lapMap.get(n);
    if (dt == null) return null;
    t -= dt;
  }
  return t;
}

function walkFromAnchorStart(
  driver: ManualDriver,
  lapNumber: number,
  sync: ManualSessionSync
): number | null {
  const anchor = anchorForRole(sync, driver.role);
  const base = anchorBaseTime(sync, anchor);
  if (!anchor || base == null || anchor.anchorKind !== "sf_start") return null;

  const lapMap = lapTimeMap(driver);
  const anchorLap = anchor.lapNumber;
  if (!lapMap.has(lapNumber)) return null;

  const same = sameHeatTimeAtAnchorLap(driver, lapNumber, sync, "start");
  if (same != null) return same;

  if (!lapMap.has(anchorLap)) return null;

  if (lapNumber > anchorLap) {
    let t = base;
    for (let n = anchorLap; n < lapNumber; n++) {
      const dt = lapMap.get(n);
      if (dt == null) return null;
      t += dt;
    }
    return t;
  }

  let t = base;
  for (let n = anchorLap - 1; n >= lapNumber; n--) {
    const dt = lapMap.get(n);
    if (dt == null) return null;
    t -= dt;
  }
  return t;
}

/**
 * A driver placed by SOMEBODY ELSE'S anchor.
 *
 * The one instant a race field shares is the tone — the start of everybody's lap 1. The old
 * shortcut assumed the field shared the anchor LAP ("everyone ends lap 2 together"), which is only
 * true of lap 1's start. Anchored on a driver's first crossing of the line — the end of their
 * lap 1 — it placed the rival half a second off, by the difference in the two opening laps. So:
 * walk the anchor driver back to the tone on THEIR lap times, then forward on this driver's.
 * That is exactly how an off-video session has always been placed against the reference anchor.
 *
 * Returns undefined when this driver is placed by their own anchor (the walk handles that) or
 * the anchor driver cannot be found; null when the lap times needed are missing.
 */
function placedByAnotherDriver(
  driver: ManualDriver,
  lapNumber: number,
  kind: AnchorKind,
  timingSession: ManualTimingSession
): number | null | undefined {
  const anchor = anchorForRole(timingSession.sync, driver.role);
  if (!anchor || anchor.driverRole === driver.role) return undefined;
  const anchorDriver = timingSession.drivers.find((d) => d.role === anchor.driverRole);
  if (!anchorDriver) return undefined;
  const base = anchorBaseTime(timingSession.sync, anchor);
  if (base == null) return undefined;
  const anchorTrans = transponderSfSec(anchorDriver, anchor.lapNumber, anchor.anchorKind);
  const targetTrans = transponderSfSec(driver, lapNumber, kind);
  if (anchorTrans == null || targetTrans == null) return null;
  return base + (targetTrans - anchorTrans);
}

/** Predicted video time (sec) when driver crosses SF at end of lapNumber. */
export function predictSfEndTime(
  driver: ManualDriver,
  lapNumber: number,
  timingSession: ManualTimingSession
): number | null {
  const sync = timingSession.sync;
  const key = lapSfKey(driver.role, lapNumber);
  if (sync.perLapSfEnd?.[key] != null) return sync.perLapSfEnd[key]!;

  const anchor = sync.anchor;
  if (!anchor) return transponderSfEndSec(driver, lapNumber);

  const shared = placedByAnotherDriver(driver, lapNumber, "sf_finish", timingSession);
  if (shared !== undefined) return shared;

  const same = sameHeatTimeAtAnchorLap(driver, lapNumber, sync, "end");
  if (same != null) return same;

  if (anchor.anchorKind === "sf_finish") {
    return walkFromAnchorFinish(driver, lapNumber, sync);
  }

  const start = walkFromAnchorStart(driver, lapNumber, sync);
  if (start == null) return null;
  const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
  if (!lap || lap.lapTimeSec <= 0) return null;
  return start + lap.lapTimeSec;
}

export function predictSfStartTime(
  driver: ManualDriver,
  lapNumber: number,
  timingSession: ManualTimingSession
): number | null {
  const sync = timingSession.sync;
  const key = lapSfKey(driver.role, lapNumber);
  if (sync.perLapSfStart?.[key] != null) return sync.perLapSfStart[key]!;

  const anchor = sync.anchor;
  if (!anchor) return transponderSfStartSec(driver, lapNumber);

  const shared = placedByAnotherDriver(driver, lapNumber, "sf_start", timingSession);
  if (shared !== undefined) return shared;

  const same = sameHeatTimeAtAnchorLap(driver, lapNumber, sync, "start");
  if (same != null) return same;

  if (anchor.anchorKind === "sf_start") {
    return walkFromAnchorStart(driver, lapNumber, sync);
  }

  const end = walkFromAnchorFinish(driver, lapNumber, sync);
  if (end == null) return null;
  const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
  if (!lap || lap.lapTimeSec <= 0) return null;

  const prev = driver.laps
    .filter((l) => l.lapNumber < lapNumber)
    .sort((a, b) => b.lapNumber - a.lapNumber)[0];

  if (prev) {
    return predictSfEndTime(driver, prev.lapNumber, timingSession);
  }

  return end - lap.lapTimeSec;
}

export type LapSfPrediction = {
  sessionId: string;
  driverRole: DriverRole;
  lapNumber: number;
  lapTimeSec: number;
  predictedEndSec: number | null;
  predictedStartSec: number | null;
  overridden: boolean;
};

export function buildSfPredictions(
  timingSession: ManualTimingSession,
  lapNumbers: { role: DriverRole; lapNumber: number }[]
): LapSfPrediction[] {
  const out: LapSfPrediction[] = [];
  const sync = timingSession.sync;
  for (const { role, lapNumber } of lapNumbers) {
    const driver = timingSession.drivers.find((d) => d.role === role);
    if (!driver) continue;
    const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
    if (!lap) continue;
    const key = lapSfKey(role, lapNumber);
    out.push({
      sessionId: timingSession.sessionId,
      driverRole: role,
      lapNumber,
      lapTimeSec: lap.lapTimeSec,
      predictedEndSec: predictSfEndTime(driver, lapNumber, timingSession),
      predictedStartSec: predictSfStartTime(driver, lapNumber, timingSession),
      overridden: sync.perLapSfEnd?.[key] != null,
    });
  }
  return out;
}

/** @deprecated use session-scoped predictSfEndTime */
export function predictSfEndTimeLegacy(
  driver: ManualDriver,
  lapNumber: number,
  sync: ManualSessionSync,
  _allDrivers: ManualDriver[]
): number | null {
  const timingSession: ManualTimingSession = {
    sessionId: "legacy",
    label: "",
    isOnVideo: true,
    drivers: _allDrivers,
    sync,
  };
  return predictSfEndTime(driver, lapNumber, timingSession);
}

/** @deprecated use session-scoped predictSfStartTime */
export function predictSfStartTimeLegacy(
  driver: ManualDriver,
  lapNumber: number,
  sync: ManualSessionSync,
  allDrivers: ManualDriver[]
): number | null {
  return predictSfEndTimeLegacy(driver, lapNumber, sync, allDrivers) != null
    ? predictSfStartTime(driver, lapNumber, {
        sessionId: "legacy",
        label: "",
        isOnVideo: true,
        drivers: allDrivers,
        sync,
      })
    : null;
}
