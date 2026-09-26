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
import { eventDateToYmd } from "@/lib/eventDateParse";
import { formatRunDateWeekday, formatRunTimeOnly } from "@/lib/formatDate";
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

// ---- When the car ran (a run typed in after the fact, test drive 2026-09-26) ----

/** The earliest a run can be dated; the server refuses anything before it. */
export const RUN_AT_MIN_INPUT = "2000-01-01T00:00";

/** An instant as an `<input type="datetime-local">` value, on this device's clock. */
export function toLocalDateTimeInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The instant a datetime-local value names, never later than `now`: a run can't have happened
 * yet. Empty, half-typed, unreadable or before 2000 gives null, which callers ignore.
 */
export function runAtFromInput(value: string, now: Date = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
  return d.getTime() > now.getTime() ? new Date(now.getTime()) : d;
}

/**
 * Where a run logged into a meeting that is already over lands when the driver picks no time:
 * midday on the meeting's last day, this device's clock (the server's own default for the same
 * case). Null while the meeting is on or ahead, where "now" is right.
 */
export function pastMeetingRunAt(
  meetingEnd: string | Date | null | undefined,
  todayYmd: string,
): Date | null {
  if (!meetingEnd) return null;
  const endYmd = eventDateToYmd(meetingEnd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endYmd) || endYmd >= todayYmd) return null;
  const [y, m, d] = endYmd.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12, 0, 0, 0);
}

function localDayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** The When line: "Today, 5:04 PM", "Yesterday, 7:30 PM", else "Fri 25 Sept, 7:30 PM". */
export function runWhenLabel(at: Date, now: Date = new Date()): string {
  const time = formatRunTimeOnly(at);
  const daysAgo = localDayNumber(now) - localDayNumber(at);
  if (daysAgo === 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  return `${formatRunDateWeekday(at, null, now)}, ${time}`;
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

// ---- Lines for things that happened out of sight ----

/**
 * What the step says when picking a track tied one of the driver's own meetings to the LiveRC
 * meeting posted after it. Tying them is the approved rule; doing it without a word made the
 * driver's meeting look like it had vanished. A name not known falls back to plain words.
 */
export function linkedMeetingNotice(
  links: ReadonlyArray<{ fromName: string | null; intoName: string | null }>,
): string | null {
  if (links.length === 0) return null;
  if (links.length > 1) return `${links.length} of your meetings joined their LiveRC meetings.`;
  const from = links[0]!.fromName?.trim();
  const into = links[0]!.intoName?.trim();
  return `${from ? `Your meeting “${from}”` : "Your meeting"} joined ${
    into ? `LiveRC’s “${into}”` : "its LiveRC meeting"
  }.`;
}

/** The browsers' own words for a request that never left the phone. */
const NO_SIGNAL_ERROR = /failed to fetch|load failed|networkerror|network request failed|network error/i;

/**
 * What a driver reads when a save fails. With no signal: the run isn't saved, nothing is lost,
 * and which button to tap again — never the browser's raw "Failed to fetch". Anything else keeps
 * the reason the save gave.
 */
export function saveFailureMessage(
  err: unknown,
  opts: { online: boolean; retryLabel: string },
): string {
  const reason = err instanceof Error ? err.message.trim() : "";
  if (!opts.online || NO_SIGNAL_ERROR.test(reason)) {
    return `No signal, so the run isn’t saved yet. Nothing is lost. Tap ${opts.retryLabel} again when you have signal.`;
  }
  return reason || "Couldn’t save the run. Try again.";
}
