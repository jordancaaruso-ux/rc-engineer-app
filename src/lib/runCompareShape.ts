import type {
  CompareRunImportedLapSet,
  CompareRunShape,
} from "@/components/runs/RunComparePanel";

/** Map a loaded run (analysis / history) into the compare / setup modal shape. */
export function toCompareRunShape(run: {
  id: string;
  userId?: string | null;
  createdAt: Date | string;
  /** Passed through as-is: the lap sheet reads who was in the heat off it. */
  importedLapSets?: CompareRunImportedLapSet[] | null;
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
  tireType?: { id: string; displayName: string } | null;
  tireStintId?: string | null;
  tireAgeKnown?: boolean | null;
  tireRunNumber: number;
  /** The front end of a front/rear run (off-road); the tire fields above are then the rear. */
  frontTireType?: { id: string; displayName: string } | null;
  frontTireStintId?: string | null;
  frontTireAgeKnown?: boolean | null;
  frontTireRunNumber?: number | null;
  /** What each end is glued to — see src/lib/tires/tireFitment.ts. */
  tireFitment?: unknown;
  additiveType?: { id: string; displayName: string } | null;
  warmerTimingMinutes?: number | null;
  tirePrep?: unknown;
  setupSnapshot?: { id: string; data?: unknown } | null;
  sessionCompletedAt?: Date | string | null;
  loggingCompletedAt?: Date | string | null;
  sortAt?: Date | string | null;
  importedLapTimeSessionId?: string | null;
}): CompareRunShape {
  return {
    id: run.id,
    userId: run.userId ?? null,
    createdAt: run.createdAt,
    importedLapSets: run.importedLapSets ?? undefined,
    sessionCompletedAt: run.sessionCompletedAt ?? null,
    loggingCompletedAt: run.loggingCompletedAt ?? null,
    sortAt: run.sortAt ?? null,
    importedLapTimeSessionId: run.importedLapTimeSessionId ?? null,
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
    tireType: run.tireType ?? null,
    tireStintId: run.tireStintId ?? null,
    tireAgeKnown: run.tireAgeKnown ?? true,
    tireRunNumber: run.tireRunNumber,
    frontTireType: run.frontTireType ?? null,
    frontTireStintId: run.frontTireStintId ?? null,
    frontTireAgeKnown: run.frontTireAgeKnown ?? null,
    frontTireRunNumber: run.frontTireRunNumber ?? null,
    tireFitment: run.tireFitment ?? null,
    additiveType: run.additiveType ?? null,
    warmerTimingMinutes: run.warmerTimingMinutes ?? null,
    tirePrep: run.tirePrep ?? null,
    setupSnapshot: run.setupSnapshot ?? null,
  };
}
