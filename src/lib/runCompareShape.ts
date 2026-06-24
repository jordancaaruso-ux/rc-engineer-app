import type { CompareRunShape } from "@/components/runs/RunComparePanel";

/** Map a loaded run (analysis / history) into the compare / setup modal shape. */
export function toCompareRunShape(run: {
  id: string;
  userId?: string | null;
  createdAt: Date | string;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  eventId?: string | null;
  event?: { name: string; track?: { name: string } | null } | null;
  car?: {
    id: string;
    name: string;
    setupSheetTemplate?: string | null;
    setupSheetModelId?: string | null;
  } | null;
  carId?: string | null;
  carNameSnapshot?: string | null;
  track?: { id: string; name: string } | null;
  trackNameSnapshot?: string | null;
  lapTimes: unknown;
  lapSession?: unknown;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  tireSet?: { id: string; label: string; setNumber: number | null } | null;
  tireRunNumber: number;
  additiveType?: { id: string; displayName: string } | null;
  warmerTimingMinutes?: number | null;
  setupSnapshot?: { id: string; data?: unknown } | null;
  sessionCompletedAt?: Date | string | null;
  loggingCompletedAt?: Date | string | null;
  sortAt?: Date | string | null;
}): CompareRunShape {
  return {
    id: run.id,
    userId: run.userId ?? null,
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt ?? null,
    loggingCompletedAt: run.loggingCompletedAt ?? null,
    sortAt: run.sortAt ?? null,
    sessionType: run.sessionType,
    meetingSessionType: run.meetingSessionType,
    meetingSessionCode: run.meetingSessionCode,
    sessionLabel: run.sessionLabel,
    eventId: run.eventId ?? null,
    event: run.event ? { name: run.event.name } : null,
    car: run.car
      ? {
          id: run.car.id,
          name: run.car.name,
          setupSheetTemplate: run.car.setupSheetTemplate,
          setupSheetModelId: run.car.setupSheetModelId ?? null,
        }
      : null,
    carId: run.carId ?? run.car?.id ?? null,
    carNameSnapshot: run.carNameSnapshot,
    track: run.track,
    trackNameSnapshot: run.trackNameSnapshot,
    lapTimes: run.lapTimes,
    lapSession: run.lapSession,
    notes: run.notes,
    driverNotes: run.driverNotes,
    handlingProblems: run.handlingProblems,
    tireSet: run.tireSet,
    tireRunNumber: run.tireRunNumber,
    additiveType: run.additiveType ?? null,
    warmerTimingMinutes: run.warmerTimingMinutes ?? null,
    setupSnapshot: run.setupSnapshot ?? null,
  };
}
