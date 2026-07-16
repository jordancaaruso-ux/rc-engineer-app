/**
 * Page-1 session-type helpers for the Log-run entry screen.
 *
 * UI model (coarse, founder interview 2026-07-16): Practice / Qualifying / Main,
 * or implicit Testing on a non-event day. Maps onto the app's `meetingSessionType`
 * enum where Main => RACE + a "Main" sessionLabel. Session type defaults to the
 * continued run's value.
 */
import type { EntryCandidate } from "@/lib/runs/entryCandidate";

export type UiSessionType = "PRACTICE" | "QUALIFYING" | "MAIN" | "TESTING";

/** Default page-1 session for the current context; carries the continued run's type. */
export function defaultUiSession(
  candidate: EntryCandidate | null,
  isEvent: boolean,
  copying: boolean,
): { type: UiSessionType } {
  if (!isEvent) return { type: "TESTING" };
  if (copying && candidate?.meetingSessionType && candidate.meetingSessionType !== "TESTING") {
    switch (candidate.meetingSessionType) {
      case "RACE":
        return { type: "MAIN" };
      case "QUALIFYING":
        return { type: "QUALIFYING" };
      case "PRACTICE":
        return { type: "PRACTICE" };
      default:
        break;
    }
  }
  return { type: "PRACTICE" };
}

/** Convert the UI session back to persisted run fields. */
export function uiSessionToMeeting(
  type: UiSessionType,
): { meetingSessionType: string | null; sessionLabel: string | null } {
  if (type === "TESTING") return { meetingSessionType: null, sessionLabel: null };
  if (type === "MAIN") return { meetingSessionType: "RACE", sessionLabel: "Main" };
  return { meetingSessionType: type, sessionLabel: null }; // PRACTICE | QUALIFYING
}

export function uiSessionLabel(type: UiSessionType): string {
  if (type === "TESTING") return "Testing";
  if (type === "MAIN") return "Main";
  return type === "PRACTICE" ? "Practice" : "Qualifying";
}
