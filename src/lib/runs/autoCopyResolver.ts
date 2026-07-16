/**
 * Auto-copy resolver for the Log-run entry screen.
 *
 * The driver picks a car first; we look up that car's most recent run and decide
 * whether the new log should **continue** from it (pre-fill setup/tires/track and
 * show "what changed?" chips) or start **fresh**.
 *
 * Rule (founder interview, 2026-07-16): continue when the picked car's last run was
 * at the **same track** (any day — the track is your setup baseline) OR in the
 * **same active event** (so day 2 of a weekend picks up from day 1). Otherwise fresh,
 * with a manual "copy a previous run" fallback offered when a prior run exists.
 *
 * Pure and deterministic — no DB access; the caller supplies the candidate run.
 */

export type CandidateRun = {
  id: string;
  /** Track the candidate run was logged at. */
  trackId: string | null;
  /** Event the candidate run was linked to, if any. */
  eventId: string | null;
  /** Meeting session type of the candidate (for defaulting page-1 session type). */
  meetingSessionType?: string | null;
  /** Session label of the candidate (e.g. "A Main"). */
  sessionLabel?: string | null;
};

export type EntryContext = {
  /** Track the driver is logging at now (from GPS/pick/event). */
  trackId: string | null;
  /** Active event now, if the log is happening inside one. */
  eventId: string | null;
};

export type AutoCopyDecision = {
  /** True => continue from `candidate`; false => fresh log. */
  continueFromLast: boolean;
  /** Why — for UI copy and debugging. */
  reason: "same-track" | "same-event" | "no-prior-run" | "different-context";
  /** The run to continue from (echoed for convenience) when continuing. */
  source: CandidateRun | null;
  /** A manual "copy a previous run" fallback is worth offering (a prior run exists but didn't auto-qualify). */
  offerManualCopy: boolean;
};

export function resolveAutoCopy(
  candidate: CandidateRun | null | undefined,
  context: EntryContext,
): AutoCopyDecision {
  if (!candidate) {
    return { continueFromLast: false, reason: "no-prior-run", source: null, offerManualCopy: false };
  }

  const sameTrack = candidate.trackId != null && candidate.trackId === context.trackId;
  const sameEvent = candidate.eventId != null && candidate.eventId === context.eventId;

  if (sameTrack || sameEvent) {
    return {
      continueFromLast: true,
      reason: sameTrack ? "same-track" : "same-event",
      source: candidate,
      offerManualCopy: false,
    };
  }

  // A prior run exists but is at a different track / event — don't auto-copy, but
  // let the driver pull it in manually if they want.
  return { continueFromLast: false, reason: "different-context", source: candidate, offerManualCopy: true };
}
