/**
 * Session-step helpers for the Log-run wizard, one section each below.
 *
 * Session model: the step's buttons are Practice / Seeding / Qualifying / Race, or implicit
 * Testing on a non-event day, and the session type defaults to the continued run's. A copied
 * run keeps its own type, and a race keeps its own label ("A Main"), so the step says what the
 * run it came from said (test drive 2026-09-26). The coarse July model (Practice / Qualifying /
 * Main, Main => RACE + a "Main" label) is retired: its buttons are gone, and the "Main" label a
 * copy saved read "Race · Main" beside "Race" runs logged the same way.
 */
import type { EntryCandidate } from "@/lib/runs/entryCandidate";
import { defaultEventName } from "@/lib/events/liveRcMeetingMatch";
import { formatRunSessionDisplay } from "@/lib/runSession";

export type UiSessionType = "PRACTICE" | "SEEDING" | "QUALIFYING" | "RACE" | "TESTING";

/** Default page-1 session for the current context; carries the continued run's type. */
export function defaultUiSession(
  candidate: EntryCandidate | null,
  isEvent: boolean,
  copying: boolean,
): { type: UiSessionType } {
  if (!isEvent) return { type: "TESTING" };
  if (copying) {
    switch (candidate?.meetingSessionType) {
      case "RACE":
        return { type: "RACE" };
      case "QUALIFYING":
        return { type: "QUALIFYING" };
      case "SEEDING":
        return { type: "SEEDING" };
      case "PRACTICE":
        return { type: "PRACTICE" };
      default:
        break;
    }
  }
  return { type: "PRACTICE" };
}

/**
 * Convert the UI session back to persisted run fields. A label only ever qualifies a race
 * ("A Main"), so it rides along on RACE and nowhere else.
 */
export function uiSessionToMeeting(
  type: UiSessionType,
  raceLabel: string | null = null,
): { meetingSessionType: string | null; sessionLabel: string | null } {
  if (type === "TESTING") return { meetingSessionType: null, sessionLabel: null };
  return { meetingSessionType: type, sessionLabel: type === "RACE" ? raceLabel?.trim() || null : null };
}

export function uiSessionLabel(type: UiSessionType): string {
  switch (type) {
    case "TESTING":
      return "Testing";
    case "SEEDING":
      return "Seeding";
    case "QUALIFYING":
      return "Qualifying";
    case "RACE":
      return "Race";
    default:
      return "Practice";
  }
}

/**
 * An event-day session as the Log-run form names it: the ticked button's word, then the run's
 * own label when it has one ("Race", "Race · A Main"), the way Sessions lists the saved run. The
 * label used to stand in for the word, so a copied race read "Main" beside a ticked "Race".
 */
export function meetingSessionKind(
  meetingSessionType: string | null | undefined,
  sessionLabel?: string | null,
): string {
  return formatRunSessionDisplay({
    sessionType: "RACE_MEETING",
    meetingSessionType: meetingSessionType || "PRACTICE",
    sessionLabel: sessionLabel ?? null,
  });
}

// ---- The New event form's filled-in name ----

/**
 * The New event form's name once its dates move: the filled-in "Track · Sat 26 Sep" follows the
 * first day, and a name the driver typed stays theirs. Null means leave the box alone.
 */
export function followDateEventName(input: {
  name: string;
  /** The name the form filled in itself; null once the driver typed their own. */
  autoName: string | null;
  trackName: string;
  startYmd: string;
}): string | null {
  if (!input.autoName || input.name !== input.autoName) return null;
  const track = input.trackName.trim();
  if (!track || !/^\d{4}-\d{2}-\d{2}$/.test(input.startYmd)) return null;
  const next = defaultEventName(track, input.startYmd);
  return next === input.name ? null : next;
}
