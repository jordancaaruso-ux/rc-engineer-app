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
  meetingSessionType: string | null;
  sessionLabel: string | null;
  whenIso: string;
};

type CandidateRow = {
  id: string;
  createdAt: Date;
  carId: string | null;
  carNameSnapshot?: string | null;
  trackId: string | null;
  trackNameSnapshot?: string | null;
  eventId: string | null;
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
    meetingSessionType: row.meetingSessionType ?? null,
    sessionLabel: row.sessionLabel ?? null,
    whenIso: row.createdAt.toISOString(),
  };
}
