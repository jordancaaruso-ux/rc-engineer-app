import type { ManualFrameMark, ManualVideoSessionV1 } from "./types";
import { lapSfKey } from "./types";
import { predictSfEndTime, predictSfStartTime } from "./sync";

export type SectorLineInfo = {
  lineKey: string;
  label: string;
  sortOrder: number;
};

export type ComputedSectorSplit = {
  lineKey: string;
  label: string;
  videoTimeSec: number;
  splitSec: number;
  cumulativeSec: number;
};

export type LapSectorBreakdown = {
  driverRole: "me" | "competitor";
  lapNumber: number;
  lapTimeSec: number;
  lapStartSec: number | null;
  lapEndSec: number | null;
  sectors: ComputedSectorSplit[];
  complete: boolean;
};

function getMark(
  marks: ManualFrameMark[],
  role: "me" | "competitor",
  lapNumber: number,
  lineKey: string
): number | undefined {
  const m = marks.find(
    (x) => x.driverRole === role && x.lapNumber === lapNumber && x.lineKey === lineKey
  );
  return m?.videoTimeSec;
}

export function computeLapBreakdown(
  session: ManualVideoSessionV1,
  sectorLines: SectorLineInfo[],
  driverRole: "me" | "competitor",
  lapNumber: number
): LapSectorBreakdown | null {
  const driver = session.drivers.find((d) => d.role === driverRole);
  if (!driver) return null;
  const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
  if (!lap) return null;

  const ordered = [...sectorLines].sort((a, b) => a.sortOrder - b.sortOrder);
  const nonSf = ordered.filter((l) => l.lineKey !== "sf");
  const sfKey = "sf";

  let lapStart =
    getMark(session.marks, driverRole, lapNumber, "__lap_start__") ??
    predictSfStartTime(driver, lapNumber, session.sync, session.drivers);
  let lapEnd =
    getMark(session.marks, driverRole, lapNumber, sfKey) ??
    session.sync.perLapSfEnd?.[lapSfKey(driverRole, lapNumber)] ??
    predictSfEndTime(driver, lapNumber, session.sync, session.drivers);

  const sectors: ComputedSectorSplit[] = [];
  let prev = lapStart;

  for (const line of nonSf) {
    const t = getMark(session.marks, driverRole, lapNumber, line.lineKey);
    if (t == null || prev == null) {
      sectors.push({
        lineKey: line.lineKey,
        label: line.label,
        videoTimeSec: t ?? 0,
        splitSec: 0,
        cumulativeSec: 0,
      });
      continue;
    }
    const splitSec = t - prev;
    sectors.push({
      lineKey: line.lineKey,
      label: line.label,
      videoTimeSec: t,
      splitSec,
      cumulativeSec: t - (lapStart ?? t),
    });
    prev = t;
  }

  if (lapEnd != null && prev != null) {
    sectors.push({
      lineKey: sfKey,
      label: "SF end",
      videoTimeSec: lapEnd,
      splitSec: lapEnd - prev,
      cumulativeSec: lapEnd - (lapStart ?? lapEnd),
    });
  }

  const requiredKeys = [...nonSf.map((l) => l.lineKey), sfKey];
  const complete = requiredKeys.every((k) => getMark(session.marks, driverRole, lapNumber, k) != null) ||
    (nonSf.every((l) => getMark(session.marks, driverRole, lapNumber, l.lineKey) != null) && lapEnd != null);

  return {
    driverRole,
    lapNumber,
    lapTimeSec: lap.lapTimeSec,
    lapStartSec: lapStart,
    lapEndSec: lapEnd,
    sectors,
    complete,
  };
}

export type SectorCompareRow = {
  lineKey: string;
  label: string;
  meBestSec: number | null;
  competitorBestSec: number | null;
  deltaSec: number | null;
};

export function compareBestLaps(
  session: ManualVideoSessionV1,
  sectorLines: SectorLineInfo[]
): SectorCompareRow[] {
  const meLaps = session.selectedLaps.me;
  const compLaps = session.selectedLaps.competitor;
  if (!meLaps.length || !compLaps.length) return [];

  const meBest = Math.min(...meLaps.map((n) => session.drivers.find((d) => d.role === "me")!.laps.find((l) => l.lapNumber === n)!.lapTimeSec));
  const meLapNum = meLaps.find((n) => {
    const l = session.drivers.find((d) => d.role === "me")!.laps.find((x) => x.lapNumber === n);
    return l && l.lapTimeSec === meBest;
  })!;
  const compBest = Math.min(...compLaps.map((n) => session.drivers.find((d) => d.role === "competitor")!.laps.find((l) => l.lapNumber === n)!.lapTimeSec));
  const compLapNum = compLaps.find((n) => {
    const l = session.drivers.find((d) => d.role === "competitor")!.laps.find((x) => x.lapNumber === n);
    return l && l.lapTimeSec === compBest;
  })!;

  const meBd = computeLapBreakdown(session, sectorLines, "me", meLapNum);
  const compBd = computeLapBreakdown(session, sectorLines, "competitor", compLapNum);
  if (!meBd || !compBd) return [];

  const keys = new Set([
    ...meBd.sectors.map((s) => s.lineKey),
    ...compBd.sectors.map((s) => s.lineKey),
  ]);

  return [...keys].map((lineKey) => {
    const meS = meBd.sectors.find((s) => s.lineKey === lineKey);
    const compS = compBd.sectors.find((s) => s.lineKey === lineKey);
    const meBestSec = meS?.splitSec ?? null;
    const competitorBestSec = compS?.splitSec ?? null;
    return {
      lineKey,
      label: meS?.label ?? compS?.label ?? lineKey,
      meBestSec,
      competitorBestSec,
      deltaSec:
        meBestSec != null && competitorBestSec != null
          ? meBestSec - competitorBestSec
          : null,
    };
  });
}

export function averageSectorSplits(
  session: ManualVideoSessionV1,
  sectorLines: SectorLineInfo[],
  role: "me" | "competitor"
): Map<string, number> {
  const laps = role === "me" ? session.selectedLaps.me : session.selectedLaps.competitor;
  const sums = new Map<string, { sum: number; count: number }>();
  for (const lapNumber of laps) {
    const bd = computeLapBreakdown(session, sectorLines, role, lapNumber);
    if (!bd) continue;
    for (const s of bd.sectors) {
      if (s.splitSec <= 0) continue;
      const cur = sums.get(s.lineKey) ?? { sum: 0, count: 0 };
      cur.sum += s.splitSec;
      cur.count += 1;
      sums.set(s.lineKey, cur);
    }
  }
  const avg = new Map<string, number>();
  for (const [k, v] of sums) {
    if (v.count > 0) avg.set(k, v.sum / v.count);
  }
  return avg;
}
