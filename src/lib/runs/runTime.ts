import { startOfDayInTimeZone, wallClockAsUtcToInstant } from "@/lib/eventActive";
import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  NULL_RUN_CONDITIONS_COLUMNS,
  type RunConditionsRecord,
} from "@/lib/weather/runConditionsRecord";

/**
 * When a run was on track, and so which day it files under.
 *
 * A run carries three stamps kept apart on purpose (CLAUDE.md): `createdAt` (the row was written),
 * `sessionCompletedAt` (the on-track time the run shows — `resolveRunDisplayInstant` reads it, never
 * `sortAt`) and `sortAt` (the day the run files under and its place in that day, stamped once so a
 * re-import never reshuffles a day). Stamping `sortAt` with "now" is right for a run logged at the
 * track and wrong for every run logged after the fact (test drive, 2026-09-26): last night's
 * practice typed in this morning, a race brought in from LiveRC, a meeting from last month. Each one
 * filed under the day it was typed in — on the dashboard's today, and inside whichever meeting was
 * on that day at the track.
 *
 * So a new run is stamped from the best evidence of when the car ran, strongest first:
 *   1. the timing session its laps came from — the timing site's own clock;
 *   2. the time the racer picked (`runAtIso`);
 *   3. a meeting whose days are all over: midday on its last day — the day only, so the run still
 *      shows the time it was logged;
 *   4. nothing: the moment of saving (the column's default).
 * After that `sortAt` still never moves on its own: laps attached later keep it. It moves when the
 * racer says so (a new pick here, a drag in Sessions) and when a draft is finished on another day
 * than it was saved (`draftCompletionDay.ts`).
 */

/** No run is older than this; an earlier `runAtIso` is a typo or a broken clock. */
export const RUN_AT_EARLIEST = new Date(Date.UTC(2000, 0, 1));

/** A phone's clock can run a little fast. A pick further ahead than this is refused. */
export const RUN_AT_FUTURE_SLACK_MS = 60 * 60 * 1000;

/** An instant with its zone. A bare "2026-09-25T19:30" would be read as UTC by the server. */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export type RunAtParse = { ok: true; at: Date | null } | { ok: false; error: string };

/**
 * `runAtIso` off a run write. Absent, null or "" means the racer picked nothing. A time inside the
 * slack is clamped to `now`: it happened now, on a clock running a few minutes fast.
 */
export function parseRunAtIso(raw: unknown, now: Date): RunAtParse {
  if (raw === undefined || raw === null) return { ok: true, at: null };
  const text = typeof raw === "string" ? raw.trim() : null;
  if (text === "") return { ok: true, at: null };
  const at = text != null && ISO_INSTANT.test(text) ? new Date(text) : null;
  if (!at || Number.isNaN(at.getTime())) {
    return { ok: false, error: "That date and time isn't valid." };
  }
  if (at.getTime() < RUN_AT_EARLIEST.getTime()) {
    return { ok: false, error: "That date is too long ago." };
  }
  if (at.getTime() > now.getTime() + RUN_AT_FUTURE_SLACK_MS) {
    return { ok: false, error: "That time is in the future." };
  }
  return { ok: true, at: at.getTime() > now.getTime() ? new Date(now.getTime()) : at };
}

/**
 * A picked time repeats (three runs from last night, all "8:00 pm"), and so does a past meeting's
 * midday. Runs on one `sortAt` have no order: Sessions, the day's run numbers and "your last run"
 * would each pick one at random. So the stamp's milliseconds carry the order the runs were typed
 * in — under a second, growing through the logging day — and the minute anyone reads never moves.
 */
export function withLoggingOrder(at: Date, now: Date, timeZone: string | null | undefined): Date {
  let dayStart: Date;
  try {
    dayStart = startOfDayInTimeZone(timeZone?.trim() || "UTC", now);
  } catch {
    // A zone `Intl` refuses: the UTC day orders the runs just as well.
    dayStart = startOfDayInTimeZone("UTC", now);
  }
  const intoDayMs = Math.max(0, now.getTime() - dayStart.getTime());
  const orderMs = Math.min(999, Math.floor(intoDayMs / 86_400));
  return new Date(Math.floor(at.getTime() / 1000) * 1000 + orderMs);
}

/**
 * The calendar day an event's stored date names. Forms store a day at UTC noon and older rows sit
 * at UTC midnight: for those the UTC date IS the day. Any other time is a real instant, read on the
 * track's clock. The same rule the Sessions header reads a meeting's dates with.
 */
function eventStoredDay(stored: Date, zone: string): string | null {
  if (Number.isNaN(stored.getTime())) return null;
  const iso = stored.toISOString();
  const clock = iso.slice(11, 23);
  if (clock === "12:00:00.000" || clock === "00:00:00.000") return iso.slice(0, 10);
  return calendarYmdInTimeZone(stored, zone);
}

export type PastMeeting = {
  /** YYYY-MM-DD, on the track's calendar. */
  firstDay: string;
  lastDay: string;
  /** Midday on the last day, on the track's clock. */
  at: Date;
};

/**
 * A meeting every day of which is already over on the track's calendar. Null for a meeting that is
 * on today or still to come: a run logged into that is logged at the track, and "now" is right.
 */
export function pastMeeting(input: {
  startDate: Date;
  endDate: Date;
  /** The track's zone (`resolveTrackTimeZone`). */
  zone: string;
  now: Date;
}): PastMeeting | null {
  const lastDay = eventStoredDay(input.endDate, input.zone);
  if (!lastDay) return null;
  if (lastDay >= calendarYmdInTimeZone(input.now, input.zone)) return null;
  const firstDay = eventStoredDay(input.startDate, input.zone) ?? lastDay;
  return {
    firstDay: firstDay <= lastDay ? firstDay : lastDay,
    lastDay,
    at: wallClockAsUtcToInstant(new Date(`${lastDay}T12:00:00.000Z`), input.zone),
  };
}

/**
 * Whether the time `resolveRunSessionCompletedAtFromUpsertBody` finds in this body is an on-track
 * time. When a timing site printed no time, the lap step sends the moment the session was
 * IMPORTED and flags it (`sessionCompletedAtIsWallClock: false`). That is not when the car ran, so
 * it must never outrank the racer's own pick or file the run. Follows the resolver's order: the
 * primary set's time first, else the linked session row's, which is only ever parsed off the sheet.
 */
export function importedTimeIsOnTrack(body: {
  importedLapSets?: Array<{
    isPrimaryUser?: boolean;
    sessionCompletedAt?: string | null;
    sessionCompletedAtIsWallClock?: boolean;
  }>;
}): boolean {
  const sets = Array.isArray(body.importedLapSets) ? body.importedLapSets : [];
  const primary = sets.find((s) => s?.isPrimaryUser) ?? sets[0];
  const raw = typeof primary?.sessionCompletedAt === "string" ? primary.sessionCompletedAt.trim() : "";
  if (raw && !Number.isNaN(new Date(raw).getTime())) {
    return primary!.sessionCompletedAtIsWallClock !== false;
  }
  return true;
}

export type NewRunTime = {
  /** `sortAt` to stamp; null leaves the column's default, the moment of saving. */
  sortAt: Date | null;
  /** `sessionCompletedAt` to write. */
  sessionCompletedAt: Date | null;
  /**
   * The instant the run's weather should describe. Null = now (logged at the track); "unknown" =
   * filed on a past meeting's day with no clock, so no reading fetched now can describe it.
   */
  weatherAt: Date | null | "unknown";
};

/** A new run's stamps. See the file note for the order. */
export function stampNewRunTime(input: {
  /** Resolved from this save's timing sessions. */
  importedAt: Date | null;
  importedAtIsOnTrack: boolean;
  /** The racer's pick, validated. */
  runAt: Date | null;
  /** Set when the run is logged into a meeting whose days are all over. */
  meeting: PastMeeting | null;
}): NewRunTime {
  const { importedAt, runAt, meeting } = input;
  if (importedAt && input.importedAtIsOnTrack) {
    return { sortAt: importedAt, sessionCompletedAt: importedAt, weatherAt: importedAt };
  }
  if (runAt) return { sortAt: runAt, sessionCompletedAt: runAt, weatherAt: runAt };
  // An import-time fallback is still what the run shows, as it always was. It is not when the car
  // ran, so it files nothing.
  if (meeting) return { sortAt: meeting.at, sessionCompletedAt: importedAt, weatherAt: "unknown" };
  return { sortAt: null, sessionCompletedAt: importedAt, weatherAt: importedAt };
}

/** A stored run's time stamps, as the edit routes read them. */
export type StoredRunTime = {
  sortAt: Date;
  sessionCompletedAt: Date | null;
  createdAt: Date;
  loggingCompletedAt: Date | null;
  importedLapTimeSessionId: string | null;
  unconfirmedAt?: Date | null;
};

/** A pick this close to a time the run already carries is the racer leaving it alone. */
const SAME_TIME_MS = 60_000;

/**
 * Does this pick change the run's time? An edit screen shows the run's time and sends it back
 * untouched; read as a change, every edit would move the run to that minute and undo a drag in
 * Sessions. So a pick within a minute of the run's shown time, its `sortAt` or its stored session
 * time is no change.
 */
export function runAtChangesRun(runAt: Date, stored: StoredRunTime): boolean {
  const shown = resolveRunDisplayInstant(stored);
  return ![stored.sortAt, stored.sessionCompletedAt, shown].some(
    (d) => d != null && Math.abs(d.getTime() - runAt.getTime()) < SAME_TIME_MS
  );
}

/**
 * The run's own on-track time — a racer's pick, or the finish of a draft — which a save that says
 * nothing about time keeps. Both write `sortAt` and `sessionCompletedAt` from one instant. A timing
 * sheet's time is never this: the run's laps own that one.
 */
export function ownSessionTime(stored: StoredRunTime): Date | null {
  const t = stored.sessionCompletedAt;
  if (!t || stored.importedLapTimeSessionId != null) return null;
  return t.getTime() === stored.sortAt.getTime() ? t : null;
}

/**
 * An edited run's time. `moveTo` is set only for a changed pick, and then both stamps take it. A
 * timing session's on-track time always wins over a pick. Everything else is the whole-run write's
 * old rule, except that a time the run owns is kept rather than wiped by a save that didn't mention
 * it.
 */
export function stampEditedRunTime(input: {
  stored: StoredRunTime;
  importedAt: Date | null;
  importedAtIsOnTrack: boolean;
  runAt: Date | null;
}): { moveTo: Date | null; sessionCompletedAt: Date | null } {
  const { stored, importedAt, runAt } = input;
  if (importedAt && input.importedAtIsOnTrack) return { moveTo: null, sessionCompletedAt: importedAt };
  if (runAt && runAtChangesRun(runAt, stored)) return { moveTo: runAt, sessionCompletedAt: runAt };
  return { moveTo: null, sessionCompletedAt: ownSessionTime(stored) ?? importedAt };
}

/**
 * A draft finished after its meeting is over, with no time from a timing sheet or the racer.
 * `draftCompletionDayStamp` would file it under today, which is wrong for a meeting that has
 * ended. One saved on a meeting day keeps its day (it was saved at the meeting); any other files
 * on the meeting's last day. Null = leave `sortAt` alone.
 */
export function pastMeetingDraftSortAt(
  sortAt: Date,
  meeting: PastMeeting,
  zone: string
): Date | null {
  const day = calendarYmdInTimeZone(sortAt, zone);
  return day >= meeting.firstDay && day <= meeting.lastDay ? null : meeting.at;
}

/** How far a fetched reading's hour may sit from the run's time and still describe it. */
export const READING_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * True when a reading the weather service gave describes another time than the run's: the log
 * wizard fetches the weather at "Run complete", which is last night's run carrying this morning's
 * air. A typed reading is the racer's own and always stands; a fetched one with no stamp can't be
 * judged, so it stands too unless the run has no clock at all.
 */
export function readingIsForAnotherTime(
  reading: Pick<RunConditionsRecord, "conditionsSource" | "conditionsObservedAt">,
  runAt: Date | null | "unknown"
): boolean {
  if (runAt == null) return false;
  if (!reading.conditionsSource?.startsWith("open-meteo")) return false;
  if (runAt === "unknown") return true;
  const observed =
    reading.conditionsObservedAt == null ? null : new Date(reading.conditionsObservedAt);
  if (!observed || Number.isNaN(observed.getTime())) return false;
  return Math.abs(observed.getTime() - runAt.getTime()) > READING_TOLERANCE_MS;
}

/**
 * Put a probe track temp the racer typed back onto a reading. The weather service never supplies
 * one, so it survives a dropped reading; alone it is a manual reading.
 */
export function withTypedTrackTemp(
  reading: RunConditionsRecord | null,
  trackTempC: number | null
): RunConditionsRecord | null {
  if (trackTempC == null) return reading;
  const base = reading ?? NULL_RUN_CONDITIONS_COLUMNS;
  return {
    ...base,
    conditionsTrackTempC: trackTempC,
    conditionsSource: base.conditionsSource ?? "manual",
  };
}
