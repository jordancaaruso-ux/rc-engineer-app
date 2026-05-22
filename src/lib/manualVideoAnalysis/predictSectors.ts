import type { DriverRole, ManualVideoSessionV1 } from "./types";
import { lapSfKey } from "./types";
import { predictSfEndTime, predictSfStartTime } from "./sync";
import type { SectorLineInfo } from "./sectors";

export type PredictedCrossing = {
  lineKey: string;
  label: string;
  videoTimeSec: number;
  /** True when saved in session.marks */
  confirmed: boolean;
};

export type LapAlignmentPreview = {
  driverRole: DriverRole;
  lapNumber: number;
  lapTimeSec: number;
  lapStartSec: number | null;
  lapEndSec: number | null;
  crossings: PredictedCrossing[];
};

function getMarkTime(
  session: ManualVideoSessionV1,
  role: DriverRole,
  lapNumber: number,
  lineKey: string
): number | undefined {
  return session.marks.find(
    (m) => m.driverRole === role && m.lapNumber === lapNumber && m.lineKey === lineKey
  )?.videoTimeSec;
}

/** Equal split of lap span across sector lines (non-SF) then finish at lap end. */
export function predictEqualSplitCrossings(
  lapStartSec: number,
  lapEndSec: number,
  sectorLines: SectorLineInfo[]
): Omit<PredictedCrossing, "confirmed">[] {
  const ordered = [...sectorLines]
    .filter((l) => l.lineKey !== "sf")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const span = lapEndSec - lapStartSec;
  if (span <= 0) return [];

  const steps = ordered.length + 1;
  const out: Omit<PredictedCrossing, "confirmed">[] = [];
  ordered.forEach((line, i) => {
    out.push({
      lineKey: line.lineKey,
      label: line.label,
      videoTimeSec: lapStartSec + (span * (i + 1)) / steps,
    });
  });
  out.push({
    lineKey: "sf",
    label: "Finish",
    videoTimeSec: lapEndSec,
  });
  return out;
}

export function getLapAlignmentPreview(
  session: ManualVideoSessionV1,
  sectorLines: SectorLineInfo[],
  role: DriverRole,
  lapNumber: number
): LapAlignmentPreview | null {
  const driver = session.drivers.find((d) => d.role === role);
  if (!driver) return null;
  const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
  if (!lap) return null;

  const lapStartSec =
    getMarkTime(session, role, lapNumber, "__lap_start__") ??
    predictSfStartTime(driver, lapNumber, session.sync, session.drivers);
  const lapEndSec =
    getMarkTime(session, role, lapNumber, "sf") ??
    session.sync.perLapSfEnd?.[lapSfKey(role, lapNumber)] ??
    predictSfEndTime(driver, lapNumber, session.sync, session.drivers);

  if (lapStartSec == null || lapEndSec == null) {
    return {
      driverRole: role,
      lapNumber,
      lapTimeSec: lap.lapTimeSec,
      lapStartSec,
      lapEndSec,
      crossings: [],
    };
  }

  const predicted = predictEqualSplitCrossings(lapStartSec, lapEndSec, sectorLines);
  const crossings: PredictedCrossing[] = predicted.map((p) => {
    const confirmed = getMarkTime(session, role, lapNumber, p.lineKey) != null;
    const t = getMarkTime(session, role, lapNumber, p.lineKey) ?? p.videoTimeSec;
    return { ...p, videoTimeSec: t, confirmed };
  });

  return {
    driverRole: role,
    lapNumber,
    lapTimeSec: lap.lapTimeSec,
    lapStartSec,
    lapEndSec,
    crossings,
  };
}

/** Write predicted alignment (marks at current preview times) for a lap. */
export function confirmLapAlignmentMarks(
  session: ManualVideoSessionV1,
  sectorLines: SectorLineInfo[],
  role: DriverRole,
  lapNumber: number
): ManualVideoSessionV1 {
  const preview = getLapAlignmentPreview(session, sectorLines, role, lapNumber);
  if (!preview || preview.crossings.length === 0) return session;

  const marks = session.marks.filter(
    (m) => !(m.driverRole === role && m.lapNumber === lapNumber)
  );
  for (const c of preview.crossings) {
    marks.push({
      driverRole: role,
      lapNumber,
      lineKey: c.lineKey,
      videoTimeSec: c.videoTimeSec,
    });
  }
  return { ...session, marks };
}
