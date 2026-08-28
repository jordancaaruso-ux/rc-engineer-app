import { calendarDayDifference, calendarYmdInTimeZone } from "@/lib/formatDate";
import { eventDateToYmd } from "@/lib/eventDateParse";

/**
 * Which unfinished run should the app offer to finish?
 *
 * A draft row exists only because the driver tapped **Save draft** — the wizard's silent autosave
 * is a `localStorage` snapshot and never writes a `Run`. So every draft is deliberate.
 *
 * Earlier on 2026-08-25 that reasoning was taken one step too far and drafts were made to surface
 * on the dashboard forever. Driven on a real account it produced the state the founder reversed it
 * for: thirteen drafts, most of them four and five months of testing leftovers, stacked above the
 * day's actual content, with the yellow resume bar offering one of them. A draft that old is not
 * a plan the driver still holds — it is litter, and putting it on the front page every morning
 * makes the front page worth less.
 *
 * So the dashboard shows a draft for **three calendar days** in the driver's zone (today and the
 * two before it) and then stops. Two things this deliberately is NOT:
 *
 *  - **Not a delete.** Nothing is ever removed from the database for being old. An expired draft
 *    still lives in run history, still carries its amber "finish me" styling, and is still the
 *    driver's to finish or bin. It has simply stopped asking for the dashboard.
 *  - **Not a drop on the day it is for.** A draft banked a fortnight ahead for a meeting that is
 *    running TODAY still surfaces — that is the one case prepping ahead exists for, and losing it
 *    on race morning would be the bug, not the feature.
 *
 * What the rule also does is **rank**. Every surface that resumes a draft — the dashboard's yellow
 * bar, the dock's Log-run circle — can offer exactly one, and it has to be the one the driver
 * means *right now*. That is `[0]` of this list. There is no list anywhere in the UI: a card under
 * the bar showing the rest was built and cut the same day ("that's what the CTA 'finish' is for"),
 * so `[1..]` exists only so the ranking has something to beat.
 *
 * Kept free of Prisma so the rule is testable — see `loadResumableDrafts.ts` for the query.
 */

/**
 * How many calendar days a draft keeps its place on the dashboard, counting today as the first.
 * 3 = today, yesterday, the day before. Founder call, 2026-08-25.
 */
export const DRAFT_DASHBOARD_DAYS = 3;

export type DraftRunCandidate = {
  id: string;
  /** Row-write instant — a real instant, so it reads in the driver's zone. */
  savedAt: Date;
  eventId: string | null;
  eventName: string | null;
  /** Event calendar days, stored at UTC noon (read with `eventDateToYmd`, never a local getter). */
  eventStartDate: Date | string | null;
  eventEndDate: Date | string | null;
};

export type RankedDraftRun<T extends DraftRunCandidate = DraftRunCandidate> = T & {
  /**
   * The day this draft was made for has arrived: it was saved today, or its event is running
   * today. Drives the wording on the resume bar — "Finish today's run" is a lie about a draft
   * banked for Saturday, and a driver who reads it once stops trusting the bar.
   */
  isForToday: boolean;
};

/**
 * Inside the window, best first. Anything older is dropped from the result entirely.
 *
 * The two date fields are on **different calendars** and mixing them is a real bug this codebase
 * has already paid for once (see `joinableTeamEventLogic`): `savedAt` is a true instant and reads
 * in the driver's IANA zone, while event dates are calendar days pinned to UTC noon. At UTC+10 a
 * naive comparison puts race morning on the previous day.
 */
export function rankResumableDrafts<T extends DraftRunCandidate>(input: {
  candidates: T[];
  referenceDate: Date;
  timeZone: string;
}): Array<RankedDraftRun<T>> {
  const todayYmd = calendarYmdInTimeZone(input.referenceDate, input.timeZone);

  const ranked: Array<RankedDraftRun<T>> = [];
  for (const candidate of input.candidates) {
    const savedYmd = calendarYmdInTimeZone(candidate.savedAt, input.timeZone);
    let onEventToday = false;
    if (candidate.eventStartDate && candidate.eventEndDate) {
      const start = eventDateToYmd(candidate.eventStartDate);
      const end = eventDateToYmd(candidate.eventEndDate);
      onEventToday = start <= todayYmd && end >= todayYmd;
    }

    /*
     * Whole calendar days between the save and today, so the window turns over at local midnight
     * rather than 24 hours after whatever o'clock the driver tapped Save. A draft saved on a
     * device whose clock ran ahead reads as a negative age; that is still inside the window.
     */
    const ageDays = calendarDayDifference(candidate.savedAt, input.referenceDate, input.timeZone);
    if (ageDays > DRAFT_DASHBOARD_DAYS - 1 && !onEventToday) continue;

    ranked.push({ ...candidate, isForToday: savedYmd === todayYmd || onEventToday });
  }

  ranked.sort((a, b) => {
    // A draft banked for a meeting that is on NOW outranks this morning's scratch draft.
    if (a.isForToday !== b.isForToday) return a.isForToday ? -1 : 1;
    const byTime = b.savedAt.getTime() - a.savedAt.getTime();
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });

  return ranked;
}
