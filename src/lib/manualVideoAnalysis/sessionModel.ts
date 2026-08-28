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
  anchorForRole,
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

/** Any anchor on this session — the shared one, or a driver's own. */
export function anyAnchor(sync: ManualTimingSession["sync"]) {
  return sync.anchor ?? sync.anchorByRole?.me ?? sync.anchorByRole?.competitor;
}

/** First session marked on-video that has an SF anchor set — of any kind. */
export function referenceAnchoredSession(
  session: ManualVideoSessionV2
): ManualTimingSession | undefined {
  return session.timingSessions.find((s) => s.isOnVideo && anyAnchor(s.sync));
}

/**
 * The analysis has produced something to look at: at least one of your selected laps is marked
 * over every corner line on the session that is on the video, so a sector compare exists.
 * This is what "the analysis is already done" means when a session is reopened — the numbers
 * come from the marks, so they can be shown without the video (which usually lives on the
 * phone and was never uploaded). Such a session must never land back on "Pick the video" and
 * walk the driver through timing, lines and sync again for work it already holds.
 *
 * One complete lap, not every lap: the detector marks ten laps in a pass and leaves the odd
 * crossing it could not see, and that session is still an analysis, not a half-done one.
 */
export function hasMarkedLap(session: ManualVideoSessionV2, lineKeys: string[]): boolean {
  const primary = primaryTimingSession(session);
  if (!primary) return false;
  const corners = lineKeys.filter((k) => k !== "sf");
  const laps = session.selectedLaps.me;
  if (corners.length === 0 || laps.length === 0) return false;
  return laps.some((lapNumber) =>
    corners.every((lineKey) =>
      session.marks.some(
        (m) =>
          m.sessionId === primary.sessionId &&
          m.driverRole === "me" &&
          m.lapNumber === lapNumber &&
          m.lineKey === lineKey
      )
    )
  );
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

  // A driver placed by their OWN anchor is placed exactly; otherwise the session's shared
  // anchor still walks them, which is right whenever the field started together.
  if (ts.isOnVideo && (anchorForRole(ts.sync, role) ?? anyAnchor(ts.sync))) {
    return predict(driver, lapNumber, ts);
  }

  const ref = referenceAnchoredSession(session);
  const anchor = ref ? anyAnchor(ref.sync) : undefined;
  if (!ref || !anchor) return null;

  const refDriver = findDriverInSession(ref, anchor.driverRole);
  if (!refDriver) return null;

  const targetTrans = transponderSfSec(driver, lapNumber, kind);
  const anchorTrans = transponderSfSec(refDriver, anchor.lapNumber, anchor.anchorKind);
  if (targetTrans == null || anchorTrans == null) return null;

  const anchorVideoT = anchor.videoTimeSec + (ref.sync.globalOffsetSec ?? 0);
  return anchorVideoT + (targetTrans - anchorTrans);
}

export type CompareSfAlignment = {
  bottomSec: number;
  ghostSec: number;
  offsetSec: number;
};

/** Bottom = my lap at SF; ghost = competitor lap at SF; offset = ghost − bottom. */
export function getCompareSfAlignment(
  session: ManualVideoSessionV2,
  compare: ManualCompareState
): CompareSfAlignment | null {
  const { my, competitor, alignAt = "sf_finish", offsetNudgeSec = 0 } = compare;
  if (!my || !competitor) return null;

  const bottomSec = videoTimeAtLapSf(session, my.sessionId, my.role, my.lapNumber, alignAt);
  const ghostSec = videoTimeAtLapSf(
    session,
    competitor.sessionId,
    competitor.role,
    competitor.lapNumber,
    alignAt
  );
  if (bottomSec == null || ghostSec == null) return null;

  return {
    bottomSec,
    ghostSec,
    offsetSec: ghostSec - bottomSec + offsetNudgeSec,
  };
}

export function computeCompareOffsetSec(
  session: ManualVideoSessionV2,
  compare: ManualCompareState
): number | null {
  return getCompareSfAlignment(session, compare)?.offsetSec ?? null;
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
