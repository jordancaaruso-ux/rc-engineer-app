import type { DriverRole, ManualVideoSessionV2 } from "./types";
import { LAP_START_LINE_KEY, lapSfKey } from "./types";
import { findTimingSession } from "./sessionModel";
import { predictSfEndTime, predictSfStartTime } from "./sync";
import type { SectorLineInfo } from "./sectors";

export type PredictedCrossing = {
  lineKey: string;
  label: string;
  videoTimeSec: number;
  confirmed: boolean;
};

export type LapAlignmentPreview = {
  sessionId: string;
  driverRole: DriverRole;
  lapNumber: number;
  lapTimeSec: number;
  lapStartSec: number | null;
  lapEndSec: number | null;
  crossings: PredictedCrossing[];
};

export type LapAlignStep = {
  index: number;
  lineKey: string;
  label: string;
  videoTimeSec: number;
  isLapStart: boolean;
  isLapFinish: boolean;
};

export function parseValidLapSpan(
  start: number | null,
  end: number | null
): { start: number; end: number } | null {
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

export function isValidLapSpan(start: number | null, end: number | null): boolean {
  return parseValidLapSpan(start, end) != null;
}

export function getLapAlignSteps(preview: LapAlignmentPreview): LapAlignStep[] {
  const span = parseValidLapSpan(preview.lapStartSec, preview.lapEndSec);
  if (!span) return [];

  const { start: lapStartSec, end: lapEndSec } = span;

  const steps: LapAlignStep[] = [
    {
      index: 0,
      lineKey: LAP_START_LINE_KEY,
      label: "Lap start (SF)",
      videoTimeSec: lapStartSec,
      isLapStart: true,
      isLapFinish: false,
    },
  ];

  const sectors = preview.crossings
    .filter((c) => c.lineKey !== "sf")
    .sort((a, b) => a.videoTimeSec - b.videoTimeSec);

  for (const c of sectors) {
    steps.push({
      index: steps.length,
      lineKey: c.lineKey,
      label: c.label,
      videoTimeSec: c.videoTimeSec,
      isLapStart: false,
      isLapFinish: false,
    });
  }

  steps.push({
    index: steps.length,
    lineKey: "sf",
    label: "Lap finish (SF)",
    videoTimeSec: lapEndSec,
    isLapStart: false,
    isLapFinish: true,
  });

  return steps;
}

function getMarkTime(
  session: ManualVideoSessionV2,
  sessionId: string,
  role: DriverRole,
  lapNumber: number,
  lineKey: string
): number | undefined {
  return session.marks.find(
    (m) =>
      m.sessionId === sessionId &&
      m.driverRole === role &&
      m.lapNumber === lapNumber &&
      m.lineKey === lineKey
  )?.videoTimeSec;
}

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
  session: ManualVideoSessionV2,
  sectorLines: SectorLineInfo[],
  sessionId: string,
  role: DriverRole,
  lapNumber: number
): LapAlignmentPreview | null {
  const timingSession = findTimingSession(session, sessionId);
  if (!timingSession) return null;
  const driver = timingSession.drivers.find((d) => d.role === role);
  if (!driver) return null;
  const lap = driver.laps.find((l) => l.lapNumber === lapNumber);
  if (!lap) return null;

  const sync = timingSession.sync;

  const lapStartSec =
    getMarkTime(session, sessionId, role, lapNumber, LAP_START_LINE_KEY) ??
    predictSfStartTime(driver, lapNumber, timingSession);
  const lapEndSec =
    getMarkTime(session, sessionId, role, lapNumber, "sf") ??
    sync.perLapSfEnd?.[lapSfKey(role, lapNumber)] ??
    predictSfEndTime(driver, lapNumber, timingSession);

  if (!parseValidLapSpan(lapStartSec, lapEndSec)) {
    return {
      sessionId,
      driverRole: role,
      lapNumber,
      lapTimeSec: lap.lapTimeSec,
      lapStartSec,
      lapEndSec,
      crossings: [],
    };
  }

  const span = parseValidLapSpan(lapStartSec, lapEndSec)!;
  const predicted = predictEqualSplitCrossings(span.start, span.end, sectorLines);
  const crossings: PredictedCrossing[] = predicted.map((p) => {
    const marked = getMarkTime(session, sessionId, role, lapNumber, p.lineKey);
    return { ...p, videoTimeSec: marked ?? p.videoTimeSec, confirmed: marked != null };
  });

  return {
    sessionId,
    driverRole: role,
    lapNumber,
    lapTimeSec: lap.lapTimeSec,
    lapStartSec,
    lapEndSec,
    crossings,
  };
}

export function confirmLapAlignmentMarks(
  session: ManualVideoSessionV2,
  sectorLines: SectorLineInfo[],
  sessionId: string,
  role: DriverRole,
  lapNumber: number
): ManualVideoSessionV2 {
  const preview = getLapAlignmentPreview(session, sectorLines, sessionId, role, lapNumber);
  if (!preview || preview.crossings.length === 0) return session;

  const marks = session.marks.filter(
    (m) =>
      !(
        m.sessionId === sessionId &&
        m.driverRole === role &&
        m.lapNumber === lapNumber
      )
  );
  if (preview.lapStartSec != null) {
    marks.push({
      sessionId,
      driverRole: role,
      lapNumber,
      lineKey: LAP_START_LINE_KEY,
      videoTimeSec: preview.lapStartSec,
    });
  }
  for (const c of preview.crossings) {
    marks.push({
      sessionId,
      driverRole: role,
      lapNumber,
      lineKey: c.lineKey,
      videoTimeSec: c.videoTimeSec,
    });
  }
  return { ...session, marks };
}
