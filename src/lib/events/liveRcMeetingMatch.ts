import type { LiveRcEventListRow } from "@/lib/lapWatch/liveRcIndexHtmlParse";
import { addDaysToYmd } from "@/lib/events/joinableTeamEventLogic";

/**
 * Which LiveRC meeting is this? The pure half of "a driver made an event, then LiveRC posted it".
 *
 * Most clubs only put a meeting on LiveRC once the race director sets it up, usually on the
 * morning: on 19 Aug 2026 only 67 of 1,075 active LiveRC tracks listed anything ahead. So the
 * first practice run of a race day is often logged against an event the driver made by hand, and
 * LiveRC's own row turns up an hour later. These rules decide when that hand-made event IS
 * LiveRC's meeting, so the app links the two instead of offering a second event for the same
 * day (founder 2026-09-26: "if someone creates an event and then a new one appears on LiveRC, we'd
 * have to make that situation work").
 */

/** How far ahead the log-run event list looks. The window team events already use. */
export const TRACK_EVENTS_AHEAD_DAYS = 7;

/**
 * How far back the log-run event list still offers a LiveRC meeting, so Thursday's club night can
 * be picked for a run logged on Saturday (test drive 2026-09-26, W3-04: Indoor Raceway's meeting
 * of two days before could never be picked).
 */
export const TRACK_EVENTS_BEHIND_DAYS = 14;

/**
 * How far back a hand-made event still gets matched to a LiveRC meeting that appeared late — a
 * Friday event for the weekend, found again on Monday when the driver logs the Sunday runs.
 */
export const LINK_LOOKBACK_DAYS = 3;

/**
 * The longest a LiveRC row can run and still be a meeting. Clubs keep rows that span years to copy
 * from or export with: Indoor Raceway lists "Template Event Copy Only Do Not Use" and "All
 * Drivers For Exporting All Details Only" as 2022 to 2030, which read as "on today" every day and
 * stopped every hand-made meeting there from ever finding the real one (W3-04). The Sessions fold
 * walks at most the same 14 days of a meeting.
 */
export const MAX_LIVERC_MEETING_DAYS = 14;

/**
 * A row spanning more than `MAX_LIVERC_MEETING_DAYS` is a placeholder, not a meeting: never
 * offered, never "on today", never matched, joined or folded into.
 */
export function isLiveRcPlaceholder(row: { startYmd: string; endYmd: string }): boolean {
  return addDaysToYmd(row.startYmd, MAX_LIVERC_MEETING_DAYS - 1) < row.endYmd;
}

/** Inclusive YYYY-MM-DD ranges share at least one day. */
export function ymdRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export type OfferedLiveRcMeeting = LiveRcEventListRow & {
  /** Today (the track's day) falls inside the dates the club listed. */
  onToday: boolean;
};

/**
 * The meetings worth offering in the event list: on today, starting within the next `aheadDays`,
 * or finished within the last `behindDays`. On today first, then soonest, then the most recent
 * past one. A meeting the page lists twice is offered once; a placeholder never.
 */
export function offeredLiveRcMeetings(
  rows: readonly LiveRcEventListRow[],
  todayYmd: string,
  aheadDays: number = TRACK_EVENTS_AHEAD_DAYS,
  behindDays: number = TRACK_EVENTS_BEHIND_DAYS,
): OfferedLiveRcMeeting[] {
  const horizon = addDaysToYmd(todayYmd, aheadDays);
  const since = addDaysToYmd(todayYmd, -behindDays);
  const seen = new Set<string>();
  const out: OfferedLiveRcMeeting[] = [];
  for (const row of rows) {
    if (seen.has(row.eventId) || isLiveRcPlaceholder(row)) continue;
    if (!ymdRangesOverlap(row.startYmd, row.endYmd, since, horizon)) continue;
    seen.add(row.eventId);
    out.push({ ...row, onToday: row.startYmd <= todayYmd && row.endYmd >= todayYmd });
  }
  const past = (m: OfferedLiveRcMeeting) => m.endYmd < todayYmd;
  return out.sort((a, b) => {
    if (a.onToday !== b.onToday) return a.onToday ? -1 : 1;
    if (past(a) !== past(b)) return past(a) ? 1 : -1;
    if (past(a)) return b.endYmd.localeCompare(a.endYmd) || a.name.localeCompare(b.name);
    return a.startYmd.localeCompare(b.startYmd) || a.name.localeCompare(b.name);
  });
}

/**
 * LiveRC's meetings that share a day with `startYmd`–`endYmd`, earliest first, each once, never a
 * placeholder. What the New event form points to before a driver makes their own copy (W1-10).
 */
export function liveRcMeetingsOnDays(
  rows: readonly LiveRcEventListRow[],
  startYmd: string,
  endYmd: string,
): LiveRcEventListRow[] {
  const byId = new Map<string, LiveRcEventListRow>();
  for (const row of rows) {
    if (byId.has(row.eventId) || isLiveRcPlaceholder(row)) continue;
    if (ymdRangesOverlap(row.startYmd, row.endYmd, startYmd, endYmd)) byId.set(row.eventId, row);
  }
  return [...byId.values()].sort(
    (a, b) => a.startYmd.localeCompare(b.startYmd) || a.name.localeCompare(b.name),
  );
}

/**
 * The one LiveRC meeting a hand-made event stands for, or null.
 *
 * Only an unambiguous match counts: exactly one meeting whose listed dates share a day with the
 * event's. None means LiveRC hasn't got it (yet). Two means the club runs two meetings that day
 * (a Mini-Z round beside the off-road club race) or listed one meeting twice (SA State Titles
 * 2026, listed as "Sep 11" and again as "Sep 12 to Sep 13") — guessing there could file a
 * driver's runs under the wrong meeting, so the event is left alone and the driver can pick.
 * Placeholder rows spanning years are not meetings and never count as a second candidate.
 */
export function liveRcMeetingForEvent(
  event: { startYmd: string; endYmd: string },
  rows: readonly LiveRcEventListRow[],
): LiveRcEventListRow | null {
  const byId = new Map<string, LiveRcEventListRow>();
  for (const row of rows) {
    if (isLiveRcPlaceholder(row)) continue;
    if (ymdRangesOverlap(row.startYmd, row.endYmd, event.startYmd, event.endYmd)) {
      byId.set(row.eventId, row);
    }
  }
  return byId.size === 1 ? [...byId.values()][0]! : null;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-09-26" → "Sat 26 Sep". Fixed English on purpose: it is also stored, inside event names. */
export function shortDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DOW[dt.getUTCDay()]} ${d} ${MON[m - 1]}`;
}

/**
 * The name the New event form fills in: "Radio Racing Cars SA · Sat 26 Sep".
 *
 * A placeholder the driver can keep or type over. Kept, it is recognisable later
 * (`isDefaultEventName`), so when LiveRC posts the meeting the event can take LiveRC's name
 * without ever overwriting one the driver chose.
 */
export function defaultEventName(trackName: string, ymd: string): string {
  return `${trackName.trim()} · ${shortDayLabel(ymd)}`;
}

/** The day in a placeholder name, any day: "Sat 26 Sep" (`shortDayLabel`). */
const DAY_LABEL_RE = new RegExp(`^(?:${DOW.join("|")}) (?:[1-9]|[12]\\d|3[01]) (?:${MON.join("|")})$`);

/**
 * True when `name` is still a placeholder the form filled in, "<track> · <day>", at one of the
 * given track names (the track as it is now, and as the event recorded it — a catalog rename must
 * not turn a placeholder into something that looks chosen).
 *
 * Any day counts, not only the event's own first day. Before the filled-in name followed the dates
 * (test drive 2026-09-26), a meeting moved to another day kept the day it was first filled in for:
 * "Indoor Raceway · Sat 26 Sep" on a meeting held on the 24th. Nobody chose that name either, so
 * LiveRC's name still replaces it.
 */
export function isDefaultEventName(
  name: string,
  trackNames: ReadonlyArray<string | null | undefined>,
): boolean {
  const n = name.trim();
  if (!n) return false;
  return trackNames.some((t) => {
    const prefix = `${t?.trim() ?? ""} · `;
    return prefix !== " · " && n.startsWith(prefix) && DAY_LABEL_RE.test(n.slice(prefix.length));
  });
}
