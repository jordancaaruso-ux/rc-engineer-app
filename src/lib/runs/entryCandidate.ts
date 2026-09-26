/**
 * Slim, serializable "run we might continue from" for the Log-run entry screen.
 * Both the last-run-overall preview (getLastRunForCopyPreview) and the per-car
 * lookup (getLastRunForCar) map into this shape, which feeds `resolveAutoCopy`
 * and the entry UI (banner + session-type default).
 */
export type EntryCandidate = {
  runId: string;
  carId: string | null;
  carName: string | null;
  trackId: string | null;
  trackName: string | null;
  eventId: string | null;
  eventName: string | null;
  /** Event end date (ISO) — lets the entry screen tell whether the event is still active. */
  eventEndIso: string | null;
  /** Coarse session type of the run ("TESTING" | "RACE_MEETING" | legacy "PRACTICE"). */
  sessionType: string | null;
  meetingSessionType: string | null;
  sessionLabel: string | null;
  whenIso: string;
};

/**
 * When a run was on track, for the "4h ago" beside it: its session time, else the time it is filed
 * under, and only then when its log was started. Read off `createdAt`, a run raced on 25 Sep and
 * logged this morning read "Practice · 4h ago" (test drive 2026-09-26). Empty with no usable stamp.
 */
export function runOnTrackIso(run: {
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  sortAt?: Date | string | null;
}): string {
  for (const stamp of [run.sessionCompletedAt, run.sortAt, run.createdAt]) {
    if (stamp == null) continue;
    const at = new Date(stamp);
    if (!Number.isNaN(at.getTime())) return at.toISOString();
  }
  return "";
}

type CandidateRow = {
  id: string;
  createdAt: Date;
  /** Read by `runOnTrackIso`; a loader that leaves them out falls back to `createdAt`. */
  sessionCompletedAt?: Date | null;
  sortAt?: Date | null;
  carId: string | null;
  carNameSnapshot?: string | null;
  trackId: string | null;
  trackNameSnapshot?: string | null;
  eventId: string | null;
  sessionType?: string | null;
  meetingSessionType: string | null;
  sessionLabel: string | null;
  car?: { id: string; name: string } | null;
  track?: { id: string; name: string } | null;
  event?: { id: string; name: string; endDate?: Date | string | null } | null;
};

export function toEntryCandidate(row: CandidateRow | null | undefined): EntryCandidate | null {
  if (!row) return null;
  const eventEnd = row.event?.endDate ?? null;
  return {
    runId: row.id,
    carId: row.carId ?? row.car?.id ?? null,
    carName: row.car?.name ?? row.carNameSnapshot ?? null,
    trackId: row.trackId ?? row.track?.id ?? null,
    trackName: row.track?.name ?? row.trackNameSnapshot ?? null,
    eventId: row.eventId ?? row.event?.id ?? null,
    eventName: row.event?.name ?? null,
    eventEndIso: eventEnd ? new Date(eventEnd).toISOString() : null,
    sessionType: row.sessionType ?? null,
    meetingSessionType: row.meetingSessionType ?? null,
    sessionLabel: row.sessionLabel ?? null,
    whenIso: runOnTrackIso(row),
  };
}
