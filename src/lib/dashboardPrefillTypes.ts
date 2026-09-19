export type DashboardSerializedRun = {
  id: string;
  createdAt: string;
  sessionType: "TESTING" | "PRACTICE" | "RACE_MEETING";
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  carId?: string;
  car?: { id: string; name: string } | null;
  trackId: string | null;
  trackLayoutId?: string | null;
  trackLayout?: { id: string; name: string } | null;
  trackDirection?: "CW" | "CCW" | null;
  eventId: string | null;
  tireTypeId: string | null;
  tireType?: { id: string; displayName: string; modelCode: string } | null;
  tireRunNumber: number;
  tireStintId: string | null;
  tireAgeKnown: boolean;
  /** The front end of a front/rear car; all null on a single-tire run. */
  frontTireTypeId?: string | null;
  frontTireType?: { id: string; displayName: string } | null;
  frontTireRunNumber?: number | null;
  frontTireStintId?: string | null;
  frontTireAgeKnown?: boolean | null;
  /** What each end is glued to — see src/lib/tires/tireFitment.ts. */
  tireFitment?: unknown;
  setupSnapshot: { id: string; data: unknown };
  event?: {
    id: string;
    name: string;
    trackId: string | null;
    startDate: string;
    endDate: string;
    notes?: string | null;
    track?: { id: string; name: string; location?: string | null } | null;
  } | null;
  track?: { id: string; name: string } | null;

  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  /** Optional LiveRC practice day URL captured with the run. */
  practiceDayUrl?: string | null;
  lapTimes?: unknown;
  lapSession?: unknown;
};

export type DashboardNewRunPrefill =
  | { mode: "first"; eventId: string; trackId: string | null }
  | { mode: "continue"; run: DashboardSerializedRun }
  | {
      mode: "imported_lap_session";
      importedLapTimeSession: {
        id: string;
        sourceUrl: string;
        parserId: string;
        /** DB `sessionCompletedAt` as ISO (canonical session instant when set). */
        sessionCompletedAtIso: string | null;
        parsedPayload: unknown;
        /** Import row `createdAt` — last-resort instant for labels when completion time is missing. */
        createdAt: string;
        eventDetectionSource: "practice" | "race" | null;
        linkedEventId: string | null;
        /**
         * Where the sweep found this session. A loose import knows its track (schema: "a loose
         * import must still know where it was"), so the form must not ask again — without it the
         * "which car were you in?" landing opened on "Select track…" and could not pull the day's
         * conditions (found driving it, 2026-09-16).
         */
        trackId: string | null;
        liveRcDriverName: string | null;
        liveRcDriverId: string | null;
      };
      /** True when session came from event lap watch / detection — any save counts as logging complete. */
      fromEventDetection: boolean;
    };
