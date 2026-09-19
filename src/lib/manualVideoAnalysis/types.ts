/** Manual video sector marking session (stored in VideoAnalysisJob.manualJson). */

export const MANUAL_VIDEO_SESSION_VERSION = 2 as const;
export const MANUAL_VIDEO_SESSION_VERSION_LEGACY = 1 as const;

/** Mark key for calculated lap start (SF crossing). */
export const LAP_START_LINE_KEY = "__lap_start__" as const;

/**
 * Whose laps a mark, an anchor or a lap selection belongs to.
 *
 * "me" is the driver; everyone else on the video is a rival. The first rival is still called
 * "competitor", so every analysis saved before this existed keeps working unchanged and the
 * two-driver case is byte-identical to what it always was — a third driver onward is "r3", "r4".
 * A role is unique across the WHOLE analysis, never per timing session: the scan files its work
 * under `role:lap:line`, so two drivers sharing a role would share a slot.
 *
 * Practice is why there can be more than two. A LiveRC practice link carries exactly one driver,
 * so the only way to have several people off practice footage is several links — each its own
 * timing session, each contributing one role here.
 */
export type DriverRole = "me" | "competitor" | `r${number}`;

/**
 * Which of a field's drivers this analysis is about.
 *
 * A timing import brings the whole heat, so most drivers are neither of the two the video is
 * being read for. Without "other" every one of them read as the competitor, and the app quietly
 * compared against whoever the timing site happened to list first.
 */
export type DriverSlot = DriverRole | "other";

/** Laps chosen for analysis, per driver. Always carries the two original slots. */
export type SelectedLaps = Partial<Record<DriverRole, number[]>> & {
  me: number[];
  competitor: number[];
};

const RIVAL_ROLE_RE = /^r(?:[2-9]|[1-9]\d+)$/;

/** A role string off disk or out of a scan id — null when it is not one. */
export function asDriverRole(v: unknown): DriverRole | null {
  if (v === "me" || v === "competitor") return v;
  if (typeof v === "string" && RIVAL_ROLE_RE.test(v)) return v as DriverRole;
  return null;
}

/** Same, but never null: anything unrecognised reads as the driver. */
export function parseDriverRole(v: unknown): DriverRole {
  return asDriverRole(v) ?? "me";
}

export function isRivalRole(role: DriverRole): boolean {
  return role !== "me";
}

/**
 * The next free rival seat.
 *
 * "competitor" first, so adding one other driver writes exactly the analysis the app has always
 * written; "r3" onward after that, numbered by how many people are on the video rather than by
 * how many rivals — which is the number the chips on screen show.
 */
export function nextRivalRole(used: Iterable<DriverRole>): DriverRole {
  const taken = new Set<string>(used);
  if (!taken.has("competitor")) return "competitor";
  for (let n = 3; n < 64; n++) {
    const role = `r${n}` as DriverRole;
    if (!taken.has(role)) return role;
  }
  return "r64";
}

/** Copy of `selectedLaps` with one driver's laps replaced. */
export function withSelectedLaps(
  prev: SelectedLaps,
  role: DriverRole,
  laps: number[]
): SelectedLaps {
  return { ...prev, me: prev.me, competitor: prev.competitor, [role]: laps };
}
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
  role: DriverSlot;
  laps: ManualDriverLap[];
};

export type ManualSyncAnchor = {
  videoTimeSec: number;
  lapNumber: number;
  driverRole: DriverRole;
  anchorKind: AnchorKind;
};

export type ManualSessionSync = {
  /**
   * The session's anchor — one tie point between the timing clock and the video clock.
   *
   * In a race this one point serves the whole field, because everybody leaves together: each
   * driver then walks their own lap times from it. In practice, drivers start whenever they like,
   * so their timing clocks share nothing and a single anchor places only the driver it was set on.
   * That is what `anchorByRole` is for.
   */
  anchor?: ManualSyncAnchor;
  /**
   * A driver's own tie point, when they have one. Beats `anchor` for that driver.
   *
   * Without this there was no way to tell the app when the RIVAL went past — their crossings were
   * placed purely by assuming a shared start, and a driver who could see the rival cross the line
   * had nowhere to say so.
   */
  anchorByRole?: Partial<Record<DriverRole, ManualSyncAnchor>>;
  globalOffsetSec?: number;
  perLapSfEnd?: Record<string, number>;
  /** Video time (sec) at SF lap start when transponder walk differs from scrubbed sync. */
  perLapSfStart?: Record<string, number>;
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

/** One thing the detector saw cross a line, kept beside a mark so a rule can be re-run without a re-scan. */
export type ManualScanCandidate = {
  t: number;
  quality: number;
  colour?: { r: number; g: number; b: number };
  /** Where on the frame, in video pixels — absent on records built before positions were kept. */
  x?: number;
  y?: number;
  /** Which way it crossed — see `CrossingEvent.dir`. */
  dir?: 1 | -1;
  /** How sure the window was of it — see `CrossingEvent.source`. */
  source?: "confirmed" | "rescued" | "unconfirmed";
};

/** One car the picker offered at one line, with every verdict the timing put under it. */
export type ManualIdentifyOption = ManualScanCandidate & {
  offsetSec: number;
  hint?: "yours" | "other";
  movesWith?: { key: string; name: string; mine: boolean; hits: number; of: number };
  offLine?: boolean;
  outOfOrder?: boolean;
  offField?: boolean;
  shortLine?: boolean;
  hairpin?: boolean;
  wrongWay?: boolean;
  dropped?: boolean;
};

/**
 * The last "Which one is your car?" — every picture offered, what was said under each, what was
 * picked for the driver and what they tapped. The picker's options were never saved before, so
 * "S4 picked the wrong crossing" (2026-08-28, a hairpin) could only be argued from a description.
 */
export type ManualIdentifyRecord = {
  at: string;
  sessionId: string;
  driverRole: DriverRole;
  lapNumber: number;
  lapStartSec: number;
  lapTimeSec: number;
  lines: Array<{
    lineKey: string;
    options: ManualIdentifyOption[];
    field?: { fromSec: number; toSec: number; cars: number };
  }>;
  /** What the screen picked before any tap, by line key: the option's video time. */
  prePicked: Record<string, number>;
  /** What went on to the scan, by line key: the option's video time. Absent if cancelled. */
  chosen?: Record<string, number>;
  /** True when every line was decided without a tap and the picker was skipped. */
  auto?: boolean;
};

export type ManualFrameMark = {
  sessionId: string;
  driverRole: DriverRole;
  lapNumber: number;
  lineKey: string;
  videoTimeSec: number;
  /** How the time was reached — absent on a hand mark. */
  source?: "confirmed" | "rescued" | "unconfirmed";
  /**
   * Which way the car crossed, when the detector chose this time. The line's direction for
   * every later scan of this session — see `findCrossings/direction.ts`. Absent on a hand mark.
   */
  dir?: 1 | -1;
  /** Everything else the window saw, when this mark came from the detector. */
  candidates?: ManualScanCandidate[];
};

/** One row of the last automatic scan: what was found, held back or missed, and what was on offer. */
export type ManualScanRow = {
  driverRole: DriverRole;
  lapNumber: number;
  lineKey: string;
  /** Null when nothing was found for this lap and line. */
  videoTimeSec: number | null;
  source: "confirmed" | "rescued" | "unconfirmed" | null;
  suspect: boolean;
  claimedBy?: { by: string; key: string; lapNumber: number };
  candidates: ManualScanCandidate[];
};

/**
 * The last automatic scan, complete — found, held back and missing alike, with every candidate.
 *
 * A mark is a decision; this is the evidence. Every rule that decides between candidates (the
 * chain, the plausibility check, the field matching) can be replayed on it in seconds, where a
 * re-scan costs minutes of decoding and the machine to itself.
 */
export type ManualScanRecord = {
  at: string;
  sessionId: string;
  rows: ManualScanRow[];
};

/** Normalized crop in video pixel space (0–1), persisted in manualJson. */
export type VideoViewCropNorm = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ManualVideoSessionV2 = {
  version: typeof MANUAL_VIDEO_SESSION_VERSION;
  timingSource: "run" | "url";
  timingUrls?: string[];
  localVideoName?: string | null;
  /**
   * When the recording began (UTC), read from the file's own header. With it, a practice
   * session's LiveRC start stamp says where that driver's lap 1 is on the video — `wallClock.ts`.
   */
  localVideoRecordedAtIso?: string | null;
  /** Snipping-tool crop — zooms playback to the track region only. */
  viewCropNorm?: VideoViewCropNorm;
  timingSessions: ManualTimingSession[];
  compare: ManualCompareState;
  selectedLaps: SelectedLaps;
  marks: ManualFrameMark[];
  lastScan?: ManualScanRecord;
  lastIdentify?: ManualIdentifyRecord;
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

export function lapSfKey(role: DriverSlot, lapNumber: number): string {
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
    perLapSfStart:
      syncRaw.perLapSfStart && typeof syncRaw.perLapSfStart === "object"
        ? (syncRaw.perLapSfStart as Record<string, number>)
        : undefined,
    anchor: anchorRaw
      ? {
          videoTimeSec: Number(anchorRaw.videoTimeSec) || 0,
          lapNumber: Number(anchorRaw.lapNumber) || 1,
          driverRole: parseDriverRole(anchorRaw.driverRole),
          anchorKind: "sf_finish",
        }
      : undefined,
  };

  const marks = (raw.marks as Array<Record<string, unknown>>).map((m) => ({
    sessionId,
    driverRole: parseDriverRole(m.driverRole),
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
    compare: { my: null, competitor: null, alignAt: "sf_finish" },
    selectedLaps: {
      me: selected.me as number[],
      competitor: selected.competitor as number[],
    },
    marks,
  };
}

/**
 * Every driver's chosen laps, not just the first two.
 *
 * The two original slots are required — an analysis without them is not one — but a third driver
 * onward has to survive a reload too, and reading only `me` and `competitor` would silently drop
 * their lap choices while leaving their marks in place.
 */
function parseSelectedLaps(raw: Record<string, unknown>): SelectedLaps {
  const out: SelectedLaps = {
    me: raw.me as number[],
    competitor: raw.competitor as number[],
  };
  for (const [key, value] of Object.entries(raw)) {
    const role = asDriverRole(key);
    if (!role || role === "me" || role === "competitor") continue;
    if (Array.isArray(value)) out[role] = value.filter((n) => typeof n === "number");
  }
  return out;
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
      role: parseDriverRole(o.role),
      lapNumber: o.lapNumber,
    };
  };

  return {
    version: MANUAL_VIDEO_SESSION_VERSION,
    timingSource: raw.timingSource === "url" ? "url" : "run",
    timingUrls: Array.isArray(raw.timingUrls) ? (raw.timingUrls as string[]) : [],
    localVideoName: typeof raw.localVideoName === "string" ? raw.localVideoName : null,
    localVideoRecordedAtIso:
      typeof raw.localVideoRecordedAtIso === "string" ? raw.localVideoRecordedAtIso : null,
    viewCropNorm:
      raw.viewCropNorm && typeof raw.viewCropNorm === "object"
        ? (raw.viewCropNorm as VideoViewCropNorm)
        : undefined,
    timingSessions: raw.timingSessions as ManualTimingSession[],
    compare: {
      my: parseSlot(compareRaw.my),
      competitor: parseSlot(compareRaw.competitor),
      alignAt: compareRaw.alignAt === "sf_start" ? "sf_start" : "sf_finish",
      offsetNudgeSec:
        typeof compareRaw.offsetNudgeSec === "number" ? compareRaw.offsetNudgeSec : undefined,
    },
    selectedLaps: parseSelectedLaps(selected),
    marks: raw.marks as ManualFrameMark[],
    lastScan:
      raw.lastScan && typeof raw.lastScan === "object" && Array.isArray((raw.lastScan as ManualScanRecord).rows)
        ? (raw.lastScan as ManualScanRecord)
        : undefined,
    lastIdentify:
      raw.lastIdentify &&
      typeof raw.lastIdentify === "object" &&
      Array.isArray((raw.lastIdentify as ManualIdentifyRecord).lines)
        ? (raw.lastIdentify as ManualIdentifyRecord)
        : undefined,
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
    compare: { my: null, competitor: null, alignAt: "sf_finish" },
    selectedLaps: { me: [], competitor: [] },
    marks: [],
  };
}

export function newTimingSessionId(): string {
  return `ts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
