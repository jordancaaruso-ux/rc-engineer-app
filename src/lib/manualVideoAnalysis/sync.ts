import type {
  AnchorKind,
  DriverRole,
  ManualDriver,
  ManualSessionSync,
  ManualTimingSession,
} from "./types";
import { lapSfKey } from "./types";

function lapTimeMap(driver: ManualDriver): Map<number, number> {
  return new Map(driver.laps.map((l) => [l.lapNumber, l.lapTimeSec]));
}

function orderedLaps(driver: ManualDriver): ManualDriver["laps"] {
  return [...driver.laps].sort((a, b) => a.lapNumber - b.lapNumber);
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

function anchorBaseTime(sync: ManualSessionSync): number | null {
  const anchor = sync.anchor;
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
  const anchor = sync.anchor;
  const base = anchorBaseTime(sync);
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
  const anchor = sync.anchor;
  const base = anchorBaseTime(sync);
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
  const anchor = sync.anchor;
  const base = anchorBaseTime(sync);
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
