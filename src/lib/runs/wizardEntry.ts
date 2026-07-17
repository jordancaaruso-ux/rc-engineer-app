/**
 * Payload the wizard host derives for the wizard-hosted NewRunForm.
 *
 * v6 (founder interview 2026-07-17, "prefill is a tap, never automatic"):
 * the host ALWAYS derives a blank entry (deriveFreshEntry) — the form's
 * Session step offers the car's last run on a manifest card and
 * applyWizardPrefill applies it in-form, reusing deriveContinueEntry for the
 * session identity rules (a race meeting re-attaches its own event and stays a
 * race meeting; a testing run carries its track). `continuing` therefore stays
 * false in the wizard payload.
 */

import type { EntryCandidate } from "@/lib/runs/entryCandidate";
import {
  defaultUiSession,
  uiSessionToMeeting,
  type UiSessionType,
} from "@/lib/runs/logRunSession";

export type NewRunWizardEntry = {
  carId: string;
  /** Copy the candidate run (continue is the contextual default). */
  continuing: boolean;
  sessionType: "TESTING" | "RACE_MEETING";
  meetingSessionType: "PRACTICE" | "QUALIFYING" | "RACE" | null;
  /** "Main" when the session is a main; null otherwise. */
  sessionLabel: string | null;
  /** Race meeting: the event this run attaches to (track derives from it). */
  eventId: string | null;
  /** Test day: the picked/auto-detected track (null when the event carries it). */
  trackId: string | null;
  /** Test day: named layout + direction picked with the track (optional). */
  trackLayoutId: string | null;
  trackDirection: "CW" | "CCW" | null;
};

/** v6: staleness no longer gates the prefill offer (an old run is still
 *  offered, honestly dated) — kept only as a wording threshold reference. */
export const CONTINUE_STALE_MS = 14 * 24 * 60 * 60 * 1000;

export function isCandidateStale(candidate: EntryCandidate, now = Date.now()): boolean {
  return now - new Date(candidate.whenIso).getTime() > CONTINUE_STALE_MS;
}

/**
 * Continue-from-last-run context. A deep-linked event wins; otherwise a race
 * meeting stays a race meeting and re-attaches its OWN event — even a past one,
 * since the driver is usually logging more runs from that meeting. When the run
 * had no formal event we keep the RACE_MEETING session type and carry the venue
 * instead. A race meeting never silently degrades to testing on copy (matches
 * the classic copy-last-run path). Only a genuinely testing run carries forward
 * as testing. (A real venue change is caught later by the in-form GPS
 * venue-mismatch swap, once location resolves.)
 */
export function deriveContinueEntry(
  candidate: EntryCandidate,
  currentEventId: string | null,
): NewRunWizardEntry {
  const base = {
    carId: candidate.carId ?? "",
    continuing: true as const,
    trackLayoutId: null,
    trackDirection: null,
  };
  // `evId` re-attaches to a live event (track then derives from it); when null
  // (event ended, or the run never had one) keep the race-meeting type but
  // carry the venue so nothing is lost.
  const race = (evId: string | null): NewRunWizardEntry => {
    const d = defaultUiSession(candidate, true, true);
    const ui: UiSessionType = d.type === "TESTING" ? "PRACTICE" : d.type;
    const meeting = uiSessionToMeeting(ui);
    return {
      ...base,
      sessionType: "RACE_MEETING",
      meetingSessionType: meeting.meetingSessionType as "PRACTICE" | "QUALIFYING" | "RACE" | null,
      sessionLabel: meeting.sessionLabel,
      eventId: evId,
      trackId: evId ? null : (candidate.trackId ?? null),
    };
  };
  if (currentEventId) return race(currentEventId);
  const wasRace =
    candidate.sessionType === "RACE_MEETING" ||
    candidate.sessionType === "PRACTICE" ||
    (candidate.meetingSessionType != null && candidate.meetingSessionType !== "TESTING");
  // Re-attach the run's own event (past events included — the GPS venue-swap
  // catches a genuine change of venue); race(null) keeps the type + venue when
  // the run had no formal event.
  if (wasRace) return race(candidate.eventId);
  return {
    ...base,
    sessionType: "TESTING",
    meetingSessionType: null,
    sessionLabel: null,
    eventId: null,
    trackId: candidate.trackId ?? null,
  };
}

/**
 * Wizard payload for hosting an EXISTING run (draft resume / edit — founder
 * 2026-07-17: "all edits open in the wizard"). Mirrors the run's own identity
 * so the first paint matches the editRun hydrate that lands right after; the
 * form skips its wizard re-assert effect when editing, so these values only
 * seed initial state (SEEDING/OTHER meeting sessions fall back to PRACTICE for
 * one frame — the hydrate restores the real value).
 */
export function deriveEditEntry(run: {
  carId?: string | null;
  sessionType?: string | null;
  meetingSessionType?: string | null;
  sessionLabel?: string | null;
  eventId?: string | null;
  trackId?: string | null;
  trackLayoutId?: string | null;
  trackDirection?: "CW" | "CCW" | null;
}): NewRunWizardEntry {
  const isRace = run.sessionType === "RACE_MEETING" || run.sessionType === "PRACTICE";
  const sub = run.meetingSessionType;
  return {
    carId: run.carId ?? "",
    continuing: false,
    sessionType: isRace ? "RACE_MEETING" : "TESTING",
    meetingSessionType: isRace
      ? sub === "QUALIFYING" || sub === "RACE" || sub === "PRACTICE"
        ? sub
        : "PRACTICE"
      : null,
    sessionLabel: run.sessionLabel ?? null,
    eventId: isRace ? (run.eventId ?? null) : null,
    trackId: run.trackId ?? null,
    trackLayoutId: run.trackLayoutId ?? null,
    trackDirection: run.trackDirection ?? null,
  };
}

/** Blank new-log context (deep-linked event honoured; GPS fills the track in-form). */
export function deriveFreshEntry(carId: string, currentEventId: string | null): NewRunWizardEntry {
  if (currentEventId) {
    return {
      carId,
      continuing: false,
      sessionType: "RACE_MEETING",
      meetingSessionType: "PRACTICE",
      sessionLabel: null,
      eventId: currentEventId,
      trackId: null,
      trackLayoutId: null,
      trackDirection: null,
    };
  }
  return {
    carId,
    continuing: false,
    sessionType: "TESTING",
    meetingSessionType: null,
    sessionLabel: null,
    eventId: null,
    trackId: null,
    trackLayoutId: null,
    trackDirection: null,
  };
}
