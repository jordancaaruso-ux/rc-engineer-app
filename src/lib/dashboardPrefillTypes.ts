export type DashboardSerializedRun = {
  id: string;
  createdAt: string;
  sessionType: "TESTING" | "PRACTICE" | "RACE_MEETING";
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  carId?: string;
  car?: { id: string; name: string } | null;
  trackId: string | null;
  eventId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
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
  tireSet?: { id: string; label: string; setNumber?: number | null } | null;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  lapTimes?: unknown;
  lapSession?: unknown;
};

export type DashboardNewRunPrefill =
  | { mode: "first"; eventId: string; trackId: string | null }
  | { mode: "continue"; run: DashboardSerializedRun };
