/**
 * Payload the wizard host derives for the wizard-hosted NewRunForm (v4,
 * founder interview 2026-07-17 evening): there is no pre-choice entry phase
 * any more — the host computes this synchronously at load (continue
 * pre-applied when the last run is recent, blank otherwise) and the form's
 * Session step carries the "Continued from run X" status + New-log switch.
 * Continuing prefills every later step (the "what changed" chips retired).
 */

import { eventDateToYmd } from "@/lib/eventDateParse";
import { localTodayYmd } from "@/lib/events/splitEventsForPicker";
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

/** Last run older than this → the wizard lands blank instead of pre-continued
 *  (founder 2026-07-17: ~two weekends; an outing that far out isn't
 *  "continuing" anything). */
export const CONTINUE_STALE_MS = 14 * 24 * 60 * 60 * 1000;

export function isCandidateStale(candidate: EntryCandidate, now = Date.now()): boolean {
  return now - new Date(candidate.whenIso).getTime() > CONTINUE_STALE_MS;
}

/**
 * Continue-from-last-run context. A deep-linked event wins; otherwise the
 * candidate's event re-attaches only while still active (end date
 * today-or-later), else its track carries as a testing baseline. (The GPS
 * venue-mismatch swap happens later, inside the form, once location resolves.)
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
  const race = (evId: string): NewRunWizardEntry => {
    const d = defaultUiSession(candidate, true, true);
    const ui: UiSessionType = d.type === "TESTING" ? "PRACTICE" : d.type;
    const meeting = uiSessionToMeeting(ui);
    return {
      ...base,
      sessionType: "RACE_MEETING",
      meetingSessionType: meeting.meetingSessionType as "PRACTICE" | "QUALIFYING" | "RACE" | null,
      sessionLabel: meeting.sessionLabel,
      eventId: evId,
      trackId: null,
    };
  };
  if (currentEventId) return race(currentEventId);
  const wasRace =
    candidate.meetingSessionType != null && candidate.meetingSessionType !== "TESTING";
  const eventActive =
    candidate.eventId != null &&
    candidate.eventEndIso != null &&
    eventDateToYmd(candidate.eventEndIso) >= localTodayYmd();
  if (wasRace && candidate.eventId && eventActive) return race(candidate.eventId);
  return {
    ...base,
    sessionType: "TESTING",
    meetingSessionType: null,
    sessionLabel: null,
    eventId: null,
    trackId: candidate.trackId ?? null,
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
