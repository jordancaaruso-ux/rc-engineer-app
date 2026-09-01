import { calendarYmdInTimeZone } from "@/lib/formatDate";

/**
 * Which day does a run that was drafted ahead of time belong to?
 *
 * `Run.sortAt` is the app's "which day is this run on" axis — run history groups on it, the
 * dashboard's today window queries it — and it is stamped once at row creation and never moves.
 * That contract is right for the ordinary run, created and finished minutes apart, and it is the
 * whole reason re-imports and edits cannot reshuffle a day.
 *
 * It is wrong for exactly one case: a draft banked before the day it was driven. Prep on Friday
 * night, race Saturday, finish logging Saturday — and the run files under FRIDAY forever, missing
 * from Saturday's group, from today's best, and from the day's run numbering.
 *
 * So the stamp moves when — and only when — the run becomes real on a different day than the row
 * was written. Same-day runs return null and are untouched, which keeps "if B finished after A, B
 * stays above A" true for every run that is not the case this exists for.
 *
 * `sessionCompletedAt` rides along because it is the column the displayed time-of-day reads
 * (`runCompareMeta` deliberately never reads `sortAt`). Without it a moved run sits correctly in
 * Saturday's group showing Friday's 8:14pm. An existing value is never overwritten: a timing import
 * knows when the car was actually on track and this function does not.
 */
export function draftCompletionDayStamp(input: {
  /** The run's current ordering stamp — what it would keep if nothing moved. */
  sortAt: Date;
  /** Session time already stored on the run, if any (a timing import wrote it). */
  storedSessionCompletedAt: Date | null;
  /** Session time resolved from THIS save's imported laps, if any. */
  importedSessionCompletedAt: Date | null;
  now: Date;
  timeZone: string;
}): { sortAt: Date; sessionCompletedAt: Date | null } | null {
  /*
   * Best evidence of when the car was actually on track, strongest first. With no timing anywhere,
   * "the moment logging was finished" is the closest honest answer — the driver is standing at the
   * track with the car in their hand — and it is the same instant the weather capture assumes.
   */
  const realInstant =
    input.importedSessionCompletedAt ?? input.storedSessionCompletedAt ?? input.now;

  const stampedDay = calendarYmdInTimeZone(input.sortAt, input.timeZone);
  const realDay = calendarYmdInTimeZone(realInstant, input.timeZone);
  if (stampedDay === realDay) return null;

  return {
    sortAt: realInstant,
    // Only ever supplies a value the run would otherwise LACK. With a timing import in this save
    // the run already stores that instant, so there is nothing to add; with a session time already
    // on the row and no new import, handing the same instant back preserves it rather than letting
    // the ordinary update path null it out.
    sessionCompletedAt: input.importedSessionCompletedAt ? null : realInstant,
  };
}
