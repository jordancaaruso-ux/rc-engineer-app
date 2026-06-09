import type {
  AnchorKind,
  CompareAlignAt,
  DriverRole,
  ManualCompareState,
  ManualDriver,
  ManualTimingSession,
  ManualVideoSessionV2,
} from "./types";
import {
  predictSfEndTime,
  predictSfStartTime,
  transponderSfSec,
} from "./sync";

export function findTimingSession(
  session: ManualVideoSessionV2,
  sessionId: string
): ManualTimingSession | undefined {
  return session.timingSessions.find((s) => s.sessionId === sessionId);
}

export function findDriverInSession(
  timingSession: ManualTimingSession,
  role: DriverRole
): ManualDriver | undefined {
  return timingSession.drivers.find((d) => d.role === role);
}

export function primaryTimingSession(session: ManualVideoSessionV2): ManualTimingSession | undefined {
  return session.timingSessions.find((s) => s.isOnVideo) ?? session.timingSessions[0];
}

/** First session marked on-video that has an SF anchor set. */
export function referenceAnchoredSession(
  session: ManualVideoSessionV2
): ManualTimingSession | undefined {
  return session.timingSessions.find((s) => s.isOnVideo && s.sync.anchor);
}

export function legacyFlatDrivers(session: ManualVideoSessionV2): ManualDriver[] {
  return primaryTimingSession(session)?.drivers ?? [];
}

export function legacyFlatSync(session: ManualVideoSessionV2) {
  return primaryTimingSession(session)?.sync ?? {};
}

function alignKind(alignAt: CompareAlignAt): AnchorKind {
  return alignAt === "sf_finish" ? "sf_finish" : "sf_start";
}

/**
 * Map a lap SF crossing to video seconds.
 * On-video anchored sessions use the anchor walk; off-video sessions map via the reference anchor.
 */
export function videoTimeAtLapSf(
  session: ManualVideoSessionV2,
  sessionId: string,
  role: DriverRole,
  lapNumber: number,
  alignAt: CompareAlignAt = "sf_finish"
): number | null {
  const ts = findTimingSession(session, sessionId);
  if (!ts) return null;
  const driver = findDriverInSession(ts, role);
  if (!driver) return null;

  const kind = alignKind(alignAt);
  const predict = kind === "sf_finish" ? predictSfEndTime : predictSfStartTime;

  if (ts.isOnVideo && ts.sync.anchor) {
    return predict(driver, lapNumber, ts);
  }

  const ref = referenceAnchoredSession(session);
  const anchor = ref?.sync.anchor;
  if (!ref || !anchor) return null;

  const refDriver = findDriverInSession(ref, anchor.driverRole);
  if (!refDriver) return null;

  const targetTrans = transponderSfSec(driver, lapNumber, kind);
  const anchorTrans = transponderSfSec(refDriver, anchor.lapNumber, anchor.anchorKind);
  if (targetTrans == null || anchorTrans == null) return null;

  const anchorVideoT = anchor.videoTimeSec + (ref.sync.globalOffsetSec ?? 0);
  return anchorVideoT + (targetTrans - anchorTrans);
}

export function computeCompareOffsetSec(
  session: ManualVideoSessionV2,
  compare: ManualCompareState
): number | null {
  const { my, competitor, alignAt = "sf_finish", offsetNudgeSec = 0 } = compare;
  if (!my || !competitor) return null;

  const tA = videoTimeAtLapSf(session, my.sessionId, my.role, my.lapNumber, alignAt);
  const tB = videoTimeAtLapSf(session, competitor.sessionId, competitor.role, competitor.lapNumber, alignAt);
  if (tA == null || tB == null) return null;

  return tB - tA + offsetNudgeSec;
}

export function updateTimingSession(
  session: ManualVideoSessionV2,
  sessionId: string,
  patch: Partial<ManualTimingSession>
): ManualVideoSessionV2 {
  return {
    ...session,
    timingSessions: session.timingSessions.map((s) =>
      s.sessionId === sessionId ? { ...s, ...patch } : s
    ),
  };
}
