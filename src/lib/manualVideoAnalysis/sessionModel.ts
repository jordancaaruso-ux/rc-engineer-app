import type {
  DriverRole,
  ManualCompareState,
  ManualDriver,
  ManualTimingSession,
  ManualVideoSessionV2,
} from "./types";
import { predictSfEndTime, predictSfStartTime } from "./sync";

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

export function legacyFlatDrivers(session: ManualVideoSessionV2): ManualDriver[] {
  return primaryTimingSession(session)?.drivers ?? [];
}

export function legacyFlatSync(session: ManualVideoSessionV2) {
  return primaryTimingSession(session)?.sync ?? {};
}

export function computeCompareOffsetSec(
  session: ManualVideoSessionV2,
  compare: ManualCompareState
): number | null {
  const { my, competitor, alignAt = "sf_start", offsetNudgeSec = 0 } = compare;
  if (!my || !competitor) return null;

  const sessA = findTimingSession(session, my.sessionId);
  const sessB = findTimingSession(session, competitor.sessionId);
  if (!sessA || !sessB) return null;

  const driverA = findDriverInSession(sessA, my.role);
  const driverB = findDriverInSession(sessB, competitor.role);
  if (!driverA || !driverB) return null;

  const predict = alignAt === "sf_finish" ? predictSfEndTime : predictSfStartTime;
  const tA = predict(driverA, my.lapNumber, sessA);
  const tB = predict(driverB, competitor.lapNumber, sessB);
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
