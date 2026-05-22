/** Manual video sector marking session (stored in VideoAnalysisJob.manualJson). */

export const MANUAL_VIDEO_SESSION_VERSION = 1 as const;

export type DriverRole = "me" | "competitor";

export type ManualDriverLap = {
  lapNumber: number;
  lapTimeSec: number;
  isIncluded?: boolean;
};

export type ManualDriver = {
  /** Stable key within session, e.g. driverId from LiveRC */
  key: string;
  driverName: string;
  normalizedName: string;
  role: DriverRole;
  laps: ManualDriverLap[];
};

export type ManualSyncAnchor = {
  videoTimeSec: number;
  lapNumber: number;
  driverRole: DriverRole;
};

export type ManualSyncState = {
  anchor?: ManualSyncAnchor;
  /** Fine-tune all predictions: added to every predicted SF time */
  globalOffsetSec?: number;
  /** Override SF crossing at end of lap: key `me:12` / `competitor:8` */
  perLapSfEnd?: Record<string, number>;
};

export type ManualFrameMark = {
  driverRole: DriverRole;
  lapNumber: number;
  lineKey: string;
  videoTimeSec: number;
};

export type ManualVideoSessionV1 = {
  version: typeof MANUAL_VIDEO_SESSION_VERSION;
  timingSource: "run" | "url";
  timingUrl?: string | null;
  /** Browser-only hint; re-pick file when reopening */
  localVideoName?: string | null;
  drivers: ManualDriver[];
  sync: ManualSyncState;
  /** Lap numbers included for sync / marking (all laps unless user discards) */
  selectedLaps: { me: number[]; competitor: number[] };
  marks: ManualFrameMark[];
};

export function lapSfKey(role: DriverRole, lapNumber: number): string {
  return `${role}:${lapNumber}`;
}

export function parseManualVideoSessionV1(raw: unknown): ManualVideoSessionV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== MANUAL_VIDEO_SESSION_VERSION) return null;
  if (!Array.isArray(o.drivers) || !o.sync || !o.selectedLaps) return null;
  return o as unknown as ManualVideoSessionV1;
}

export function emptyManualSession(): ManualVideoSessionV1 {
  return {
    version: MANUAL_VIDEO_SESSION_VERSION,
    timingSource: "run",
    drivers: [],
    sync: {},
    selectedLaps: { me: [], competitor: [] },
    marks: [],
  };
}
