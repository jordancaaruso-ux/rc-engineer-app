import type { DriverRole, ManualDriver, ManualSyncState } from "./types";
import { lapSfKey } from "./types";

/** Predicted video time (sec) when driver crosses SF at end of lapNumber. */
export function predictSfEndTime(
  driver: ManualDriver,
  lapNumber: number,
  sync: ManualSyncState,
  allDrivers: ManualDriver[]
): number | null {
  const key = lapSfKey(driver.role, lapNumber);
  if (sync.perLapSfEnd?.[key] != null) return sync.perLapSfEnd[key]!;

  const anchor = sync.anchor;
  if (!anchor) return null;

  const anchorT = anchor.videoTimeSec + (sync.globalOffsetSec ?? 0);
  const anchorLap = anchor.lapNumber;

  if (!driver.laps.some((l) => l.lapNumber === lapNumber)) return null;

  /** Same heat: all drivers cross SF on the same lap number at roughly the same video time. */
  if (lapNumber === anchorLap) return anchorT;

  const lapMap = new Map(driver.laps.map((l) => [l.lapNumber, l.lapTimeSec]));
  if (!lapMap.has(anchorLap)) return null;

  if (lapNumber > anchorLap) {
    let t = anchorT;
    for (let n = anchorLap + 1; n <= lapNumber; n++) {
      const dt = lapMap.get(n);
      if (dt == null) return null;
      t += dt;
    }
    return t;
  }

  let t = anchorT;
  for (let n = anchorLap; n > lapNumber; n--) {
    const dt = lapMap.get(n);
    if (dt == null) return null;
    t -= dt;
  }
  return t;
}

export function predictSfStartTime(
  driver: ManualDriver,
  lapNumber: number,
  sync: ManualSyncState,
  allDrivers: ManualDriver[]
): number | null {
  const end = predictSfEndTime(driver, lapNumber, sync, allDrivers);
  if (end == null) return null;

  const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
  if (!lap || lap.lapTimeSec <= 0) return null;

  const prev = driver.laps
    .filter((l) => l.lapNumber < lapNumber)
    .sort((a, b) => b.lapNumber - a.lapNumber)[0];

  if (prev) {
    return predictSfEndTime(driver, prev.lapNumber, sync, allDrivers);
  }

  /** No prior lap: start = finish − transponder time (e.g. anchored lap 1 finish). */
  return end - lap.lapTimeSec;
}

export type LapSfPrediction = {
  driverRole: DriverRole;
  lapNumber: number;
  lapTimeSec: number;
  predictedEndSec: number | null;
  predictedStartSec: number | null;
  overridden: boolean;
};

export function buildSfPredictions(
  drivers: ManualDriver[],
  sync: ManualSyncState,
  selectedLaps: { me: number[]; competitor: number[] }
): LapSfPrediction[] {
  const out: LapSfPrediction[] = [];
  for (const role of ["me", "competitor"] as DriverRole[]) {
    const driver = drivers.find((d) => d.role === role);
    if (!driver) continue;
    const laps = role === "me" ? selectedLaps.me : selectedLaps.competitor;
    for (const lapNumber of laps) {
      const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
      if (!lap) continue;
      const key = lapSfKey(role, lapNumber);
      out.push({
        driverRole: role,
        lapNumber,
        lapTimeSec: lap.lapTimeSec,
        predictedEndSec: predictSfEndTime(driver, lapNumber, sync, drivers),
        predictedStartSec: predictSfStartTime(driver, lapNumber, sync, drivers),
        overridden: sync.perLapSfEnd?.[key] != null,
      });
    }
  }
  return out;
}
