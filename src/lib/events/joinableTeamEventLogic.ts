import { eventDateToYmd } from "@/lib/eventDateParse";
import { localTodayYmd } from "@/lib/lapWatch/liveRcMeetingDates";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";

/**
 * Which of my team's events at this track could I be here for?
 *
 * This is the app's OWN answer to "is something on today", and it deliberately knows nothing about
 * LiveRC. Most events never appear on LiveRC at all — club days, MyRCM and Speedhive tracks, a bash
 * with no timing at all — so a rule that starts at a timing site can only ever cover a slice of the
 * sport. The diary someone actually booked is the universal source; a timing site is one optional
 * extra confirmation layered on top (`findEventByTrackAndResultsUrl`).
 *
 * Kept free of Prisma so the rule itself is testable — see `findJoinableTeamEvent.ts` for the query.
 */

/** How far ahead a booked event still counts as "you might be here for this". */
export const JOINABLE_EVENT_WINDOW_DAYS = 7;

export type JoinableEventCandidate = {
  id: string;
  name: string;
  startDate: Date | string;
  endDate: Date | string;
  resultsSourceUrl: string | null;
  /** Null for legacy events whose creator row was deleted. */
  userId: string | null;
};

export type JoinableEventMatch<T extends JoinableEventCandidate = JoinableEventCandidate> = T & {
  /** The reference day falls inside the event's own dates — it is on *now*, not merely soon. */
  isOnToday: boolean;
};

/** Shift a YYYY-MM-DD calendar day by whole days, staying on the UTC calendar `Event` dates use. */
export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return eventDateToYmd(new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0, 0)));
}

/**
 * Filter and rank candidate events for "offer this one to the driver".
 *
 * `eventHubUrl` is the only place a timing site gets a say, and only to *stop* a bad merge: when we
 * know which LiveRC meeting is running, an event already claiming a DIFFERENT meeting is not this
 * one, so it drops out. With no hub known there is no rival claim to contradict, so results URLs
 * stop mattering entirely — which is the fix for the case where a teammate's event was hidden
 * purely because they had pasted a results link into it.
 *
 * Callers must have already scoped `candidates` to people the viewer may join (self + team peers);
 * this function makes no access decision. See `mayJoinEvent`.
 */
export function rankJoinableTeamEvents<T extends JoinableEventCandidate>(input: {
  candidates: T[];
  referenceDate: Date;
  eventHubUrl?: string | null;
  windowDays?: number;
}): Array<JoinableEventMatch<T>> {
  /**
   * The reference instant is read as a LOCAL calendar day; the events themselves are stored at UTC
   * noon and so read correctly with `eventDateToYmd`. Mixing the two was a real bug in the code this
   * replaced: at UTC+10, 9am on race morning is still "yesterday" in UTC, so today's meeting came
   * back flagged as upcoming and the prompt offered to file the run under tomorrow.
   */
  const refYmd = localTodayYmd(input.referenceDate);
  const horizonYmd = addDaysToYmd(refYmd, input.windowDays ?? JOINABLE_EVENT_WINDOW_DAYS);
  const normalizedHub = input.eventHubUrl
    ? normalizeLiveRcEventHubUrl(input.eventHubUrl) ?? input.eventHubUrl.trim()
    : null;

  const matches: Array<JoinableEventMatch<T>> = [];
  for (const candidate of input.candidates) {
    const start = eventDateToYmd(candidate.startDate);
    const end = eventDateToYmd(candidate.endDate);
    // Overlaps [today, horizon]: already running, or starting within the window.
    if (end < refYmd || start > horizonYmd) continue;

    const claimed = candidate.resultsSourceUrl?.trim();
    if (claimed && normalizedHub) {
      const norm = normalizeLiveRcEventHubUrl(claimed) ?? claimed;
      if (norm !== normalizedHub) continue;
    }

    matches.push({
      ...candidate,
      isOnToday: start <= refYmd && end >= refYmd,
    });
  }

  matches.sort((a, b) => {
    // On now beats booked for Saturday, however tidy Saturday's row looks.
    if (a.isOnToday !== b.isOnToday) return a.isOnToday ? -1 : 1;
    // Among equals, an event with no results URL yet is the one still waiting to be filled in.
    const aClaimed = a.resultsSourceUrl?.trim() ? 1 : 0;
    const bClaimed = b.resultsSourceUrl?.trim() ? 1 : 0;
    if (aClaimed !== bClaimed) return aClaimed - bClaimed;
    const byStart =
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    if (byStart !== 0) return byStart;
    return a.id.localeCompare(b.id);
  });

  return matches;
}
