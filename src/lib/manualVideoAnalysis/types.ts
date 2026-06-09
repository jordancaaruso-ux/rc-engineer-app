/** Manual video sector marking session (stored in VideoAnalysisJob.manualJson). */

export const MANUAL_VIDEO_SESSION_VERSION = 2 as const;
export const MANUAL_VIDEO_SESSION_VERSION_LEGACY = 1 as const;

/** Mark key for calculated lap start (SF crossing). */
export const LAP_START_LINE_KEY = "__lap_start__" as const;

export type DriverRole = "me" | "competitor";
export type AnchorKind = "sf_start" | "sf_finish";
export type CompareAlignAt = "sf_start" | "sf_finish";

export type ManualDriverLap = {
  lapNumber: number;
  lapTimeSec: number;
  isIncluded?: boolean;
};

export type ManualDriver = {
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
  anchorKind: AnchorKind;
};

export type ManualSessionSync = {
  anchor?: ManualSyncAnchor;
  globalOffsetSec?: number;
  perLapSfEnd?: Record<string, number>;
};

export type ManualTimingSession = {
  sessionId: string;
  label: string;
  sourceUrl?: string | null;
  sessionCompletedAtIso?: string | null;
  isOnVideo: boolean;
  drivers: ManualDriver[];
  sync: ManualSessionSync;
};

export type ManualCompareSlot = {
  sessionId: string;
  role: DriverRole;
  lapNumber: number;
};

export type ManualCompareState = {
  my: ManualCompareSlot | null;
  competitor: ManualCompareSlot | null;
  alignAt?: CompareAlignAt;
  offsetNudgeSec?: number;
};

export type ManualFrameMark = {
  sessionId: string;
  driverRole: DriverRole;
  lapNumber: number;
  lineKey: string;
  videoTimeSec: number;
};

export type ManualVideoSessionV2 = {
  version: typeof MANUAL_VIDEO_SESSION_VERSION;
  timingSource: "run" | "url";
  timingUrls?: string[];
  localVideoName?: string | null;
  timingSessions: ManualTimingSession[];
  compare: ManualCompareState;
  selectedLaps: { me: number[]; competitor: number[] };
  marks: ManualFrameMark[];
};

/** @deprecated v1 shape — migrated on read */
export type ManualSyncState = ManualSessionSync;
export type ManualVideoSessionV1 = {
  version: typeof MANUAL_VIDEO_SESSION_VERSION_LEGACY;
  timingSource: "run" | "url";
  timingUrl?: string | null;
  localVideoName?: string | null;
  drivers: ManualDriver[];
  sync: ManualSyncState;
  selectedLaps: { me: number[]; competitor: number[] };
  marks: Array<Omit<ManualFrameMark, "sessionId">>;
};

export type ManualVideoSession = ManualVideoSessionV2;

export function lapSfKey(role: DriverRole, lapNumber: number): string {
  return `${role}:${lapNumber}`;
}

function parseV1(raw: Record<string, unknown>): ManualVideoSessionV2 | null {
  if (raw.version !== MANUAL_VIDEO_SESSION_VERSION_LEGACY) return null;
  if (!Array.isArray(raw.drivers) || !raw.sync || !raw.selectedLaps) return null;
  if (!Array.isArray(raw.marks)) return null;
  const selected = raw.selectedLaps as Record<string, unknown>;
  if (!Array.isArray(selected.me) || !Array.isArray(selected.competitor)) return null;

  const sessionId = "legacy";
  const syncRaw = raw.sync as Record<string, unknown>;
  const anchorRaw = syncRaw.anchor as Record<string, unknown> | undefined;
  const sync: ManualSessionSync = {
    globalOffsetSec:
      typeof syncRaw.globalOffsetSec === "number" ? syncRaw.globalOffsetSec : undefined,
    perLapSfEnd:
      syncRaw.perLapSfEnd && typeof syncRaw.perLapSfEnd === "object"
        ? (syncRaw.perLapSfEnd as Record<string, number>)
        : undefined,
    anchor: anchorRaw
      ? {
          videoTimeSec: Number(anchorRaw.videoTimeSec) || 0,
          lapNumber: Number(anchorRaw.lapNumber) || 1,
          driverRole: anchorRaw.driverRole === "competitor" ? "competitor" : "me",
          anchorKind: "sf_finish",
        }
      : undefined,
  };

  const marks = (raw.marks as Array<Record<string, unknown>>).map((m) => ({
    sessionId,
    driverRole: m.driverRole === "competitor" ? "competitor" : "me",
    lapNumber: Number(m.lapNumber) || 0,
    lineKey: String(m.lineKey ?? ""),
    videoTimeSec: Number(m.videoTimeSec) || 0,
  })) as ManualFrameMark[];

  return {
    version: MANUAL_VIDEO_SESSION_VERSION,
    timingSource: raw.timingSource === "url" ? "url" : "run",
    timingUrls: typeof raw.timingUrl === "string" && raw.timingUrl.trim() ? [raw.timingUrl.trim()] : [],
    localVideoName: typeof raw.localVideoName === "string" ? raw.localVideoName : null,
    timingSessions: [
      {
        sessionId,
        label: "Session",
        sourceUrl: typeof raw.timingUrl === "string" ? raw.timingUrl : null,
        isOnVideo: true,
        drivers: raw.drivers as ManualDriver[],
        sync,
      },
    ],
    compare: { my: null, competitor: null, alignAt: "sf_start" },
    selectedLaps: {
      me: selected.me as number[],
      competitor: selected.competitor as number[],
    },
    marks,
  };
}

function parseV2(raw: Record<string, unknown>): ManualVideoSessionV2 | null {
  if (raw.version !== MANUAL_VIDEO_SESSION_VERSION) return null;
  if (!Array.isArray(raw.timingSessions) || !Array.isArray(raw.marks)) return null;
  const selected = raw.selectedLaps as Record<string, unknown> | undefined;
  if (!selected || !Array.isArray(selected.me) || !Array.isArray(selected.competitor)) return null;

  const compareRaw = (raw.compare ?? {}) as Record<string, unknown>;
  const parseSlot = (s: unknown): ManualCompareSlot | null => {
    if (!s || typeof s !== "object") return null;
    const o = s as Record<string, unknown>;
    if (typeof o.sessionId !== "string" || typeof o.lapNumber !== "number") return null;
    return {
      sessionId: o.sessionId,
      role: o.role === "competitor" ? "competitor" : "me",
      lapNumber: o.lapNumber,
    };
  };

  return {
    version: MANUAL_VIDEO_SESSION_VERSION,
    timingSource: raw.timingSource === "url" ? "url" : "run",
    timingUrls: Array.isArray(raw.timingUrls) ? (raw.timingUrls as string[]) : [],
    localVideoName: typeof raw.localVideoName === "string" ? raw.localVideoName : null,
    timingSessions: raw.timingSessions as ManualTimingSession[],
    compare: {
      my: parseSlot(compareRaw.my),
      competitor: parseSlot(compareRaw.competitor),
      alignAt: compareRaw.alignAt === "sf_finish" ? "sf_finish" : "sf_start",
      offsetNudgeSec:
        typeof compareRaw.offsetNudgeSec === "number" ? compareRaw.offsetNudgeSec : undefined,
    },
    selectedLaps: { me: selected.me as number[], competitor: selected.competitor as number[] },
    marks: raw.marks as ManualFrameMark[],
  };
}

export function parseManualVideoSession(raw: unknown): ManualVideoSessionV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.timingSessions && o.version === MANUAL_VIDEO_SESSION_VERSION) return parseV2(o);
  if (o.version === MANUAL_VIDEO_SESSION_VERSION_LEGACY) return parseV1(o);
  return null;
}

export function emptyManualSession(): ManualVideoSessionV2 {
  return {
    version: MANUAL_VIDEO_SESSION_VERSION,
    timingSource: "run",
    timingSessions: [],
    compare: { my: null, competitor: null, alignAt: "sf_start" },
    selectedLaps: { me: [], competitor: [] },
    marks: [],
  };
}

export function newTimingSessionId(): string {
  return `ts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
