import { eventDateToYmd } from "@/lib/eventDateParse";
import { addDaysToYmd } from "@/lib/events/joinableTeamEventLogic";
import { isLiveRcPlaceholder, shortDayLabel, TRACK_EVENTS_AHEAD_DAYS } from "@/lib/events/liveRcMeetingMatch";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";

/**
 * The log-run event list once the track is picked.
 *
 * Founder 2026-09-26: the first tab reads Car, Track, Day type, Session, Conditions, and the event
 * list is about the track just picked ("A: switch, then list"). One list about one place: what's
 * on there today, what's coming up in the next week, and what you've raced there before — your
 * own events, your team's, and LiveRC's. It used to list every event you had ever made, anywhere,
 * and never showed LiveRC's at all.
 *
 * Pure, so the grouping is testable without a browser; the form feeds it what it has loaded.
 */

/** An event the driver is already on (participation or a run), as `/api/events` returns it. */
export type TrackListEvent = {
  id: string;
  name: string;
  trackId: string | null;
  startDate: string | Date;
  endDate: string | Date;
  resultsSourceUrl?: string | null;
};

/** A teammate's event at this track the driver is not on yet (`/api/events/joinable`). */
export type TrackListJoinable = {
  id: string;
  name: string;
  startDate: string | Date;
  endDate: string | Date;
  ownerName: string | null;
};

/** `/api/events/joinable`'s row, as the form keeps it. */
export type JoinableTeamEvent = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isOnToday: boolean;
  ownerName: string | null;
};

/** A meeting on the track's LiveRC events page (`/api/events/at-track`). */
export type TrackListLiveRcMeeting = {
  hubUrl: string;
  name: string;
  startYmd: string;
  endYmd: string;
  entries: number | null;
  /** The event row that already carries this meeting's link, when someone has made it. */
  eventId: string | null;
};

/**
 * One of the driver's own meetings that `/api/events/at-track` just joined to LiveRC's (its
 * `linked` list), with what the run form needs to say so, e.g. `Your meeting "EMCC Cup" joined
 * LiveRC's "EMCC CUP 25-27 Sept 2026"` (test drive 2026-09-26, W1-10: the meeting used to vanish
 * into LiveRC's without a word).
 */
export type EventsAtTrackLink = {
  /** The driver's meeting as it was. No longer exists when `merged`. */
  eventId: string;
  /** Its name before this read: what the driver typed, or the one the form filled in. */
  name: string;
  /** The meeting it is now: `eventId` itself when it took LiveRC's link, else the one it joined. */
  intoEventId: string;
  /** That meeting's name now. */
  intoName: string;
  /** LiveRC's name for the meeting, as the track's LiveRC events page lists it. */
  liveRcName: string;
  /** True when someone had already made LiveRC's meeting and the driver's joined it. */
  merged: boolean;
  /** LiveRC's name, when the driver's meeting kept its id and took it (it had the filled-in name). */
  renamedTo: string | null;
};

/**
 * `loading` while the page is being read, `none` when the track has no LiveRC page at all,
 * `unavailable` when it has one that could not be read just now.
 */
export type TrackLiveRcStatus = "loading" | "ok" | "none" | "unavailable";

export type TrackEventOption = {
  value: string;
  label: string;
  detail?: string | null;
  disabled?: boolean;
};

export type TrackEventGroup = { label: string; options: TrackEventOption[] };

/** A LiveRC row has no event id until someone picks it, so its value carries the meeting's link. */
export const LIVERC_OPTION_PREFIX = "liverc:";

export function liveRcOptionValue(hubUrl: string): string {
  return LIVERC_OPTION_PREFIX + hubUrl;
}

export function hubUrlFromOptionValue(value: string): string | null {
  return value.startsWith(LIVERC_OPTION_PREFIX) ? value.slice(LIVERC_OPTION_PREFIX.length) : null;
}

/** Values of the grey status rows. Disabled, so they can never be selected. */
export const TRACK_EVENTS_STATUS_VALUE = {
  loading: "status:liverc-loading",
  nothingToday: "status:liverc-nothing-today",
  unavailable: "status:liverc-unavailable",
} as const;

/** "Sat 26 Sep", "Fri 25 – Sun 27 Sep", "Fri 30 Oct – Sun 1 Nov", "Thu 31 Dec 2026 – Fri 1 Jan 2027". */
export function formatDayRange(startYmd: string, endYmd: string): string {
  if (startYmd >= endYmd) return shortDayLabel(startYmd);
  const [start, end] = [shortDayLabel(startYmd), shortDayLabel(endYmd)];
  // Across a new year both halves carry theirs: without them LiveRC's 2022-to-2030 placeholder
  // read "Tue 11 Jan – Fri 11 Jan" (W3-04).
  if (startYmd.slice(0, 4) !== endYmd.slice(0, 4)) {
    return `${start} ${startYmd.slice(0, 4)} – ${end} ${endYmd.slice(0, 4)}`;
  }
  const sameMonth = startYmd.slice(0, 7) === endYmd.slice(0, 7);
  return `${sameMonth ? start.replace(/ \w+$/, "") : start} – ${end}`;
}

function dayDiff(fromYmd: string, toYmd: string): number {
  const at = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((at(toYmd) - at(fromYmd)) / 86_400_000);
}

/** "on today", "day 2 of 3", "tomorrow", "in 5 days", "3 days ago", "2 weeks ago". */
export function relativeDayLabel(startYmd: string, endYmd: string, todayYmd: string): string {
  if (startYmd <= todayYmd && endYmd >= todayYmd) {
    const length = dayDiff(startYmd, endYmd) + 1;
    return length > 1 ? `day ${dayDiff(startYmd, todayYmd) + 1} of ${length}` : "on today";
  }
  if (startYmd > todayYmd) {
    const days = dayDiff(todayYmd, startYmd);
    return days === 1 ? "tomorrow" : `in ${days} days`;
  }
  const ago = dayDiff(endYmd, todayYmd);
  if (ago === 1) return "yesterday";
  if (ago < 14) return `${ago} days ago`;
  if (ago < 60) return `${Math.round(ago / 7)} weeks ago`;
  return `${Math.round(ago / 30)} months ago`;
}

function normalizedHub(url: string | null | undefined): string | null {
  const t = url?.trim();
  if (!t) return null;
  return normalizeLiveRcEventHubUrl(t) ?? t;
}

type Placed = { when: "today" | "soon" | "later" | "earlier"; startYmd: string; option: TrackEventOption };

function placeByDate(startYmd: string, endYmd: string, todayYmd: string, horizonYmd: string): Placed["when"] {
  if (endYmd < todayYmd) return "earlier";
  if (startYmd <= todayYmd) return "today";
  return startYmd <= horizonYmd ? "soon" : "later";
}

/**
 * Groups for the event picker at `trackId`: On today · Coming up · Later · Earlier here.
 *
 * - A LiveRC meeting the driver already has (same link, or the row it created) shows once, as
 *   the driver's own event. A teammate's event that IS a LiveRC meeting shows once, as the team's.
 * - "On today" says what LiveRC knows even when it knows nothing — a grey "Nothing on LiveRC here
 *   today yet" is the difference between "no meeting" and "the race director hasn't posted it".
 * - Nothing is picked for the driver here; this only lays the list out.
 */
export function buildTrackEventGroups(input: {
  trackId: string;
  todayYmd: string;
  aheadDays?: number;
  events: readonly TrackListEvent[];
  joinable: readonly TrackListJoinable[];
  liveRc: { status: TrackLiveRcStatus; meetings: readonly TrackListLiveRcMeeting[] };
  /** Past events at this track to list; the newest first. */
  earlierLimit?: number;
}): TrackEventGroup[] {
  const today = input.todayYmd;
  const horizon = addDaysToYmd(today, input.aheadDays ?? TRACK_EVENTS_AHEAD_DAYS);

  const mine = input.events
    .filter((e) => e.trackId === input.trackId)
    .map((e) => ({
      ...e,
      startYmd: eventDateToYmd(e.startDate),
      endYmd: eventDateToYmd(e.endDate),
      hub: normalizedHub(e.resultsSourceUrl),
    }));
  const mineIds = new Set(mine.map((e) => e.id));
  const mineHubs = new Set(mine.map((e) => e.hub).filter((h): h is string => Boolean(h)));
  const joinable = input.joinable.filter((j) => !mineIds.has(j.id));
  const joinableIds = new Set(joinable.map((j) => j.id));
  // The server already leaves placeholder rows out; a list read before that still must not show
  // an eight-year "meeting" as on today.
  const liveMeetings = input.liveRc.meetings.filter((m) => !isLiveRcPlaceholder(m));
  const live = liveMeetings.filter((m) => {
    if (m.eventId && (mineIds.has(m.eventId) || joinableIds.has(m.eventId))) return false;
    const hub = normalizedHub(m.hubUrl);
    return !(hub && mineHubs.has(hub));
  });
  /** Teammates' events that are LiveRC meetings, so their rows can say so. */
  const liveEventIds = new Set(liveMeetings.map((m) => m.eventId).filter(Boolean));

  const placed: Placed[] = [];
  for (const e of mine) {
    const when = placeByDate(e.startYmd, e.endYmd, today, horizon);
    placed.push({
      when,
      startYmd: e.startYmd,
      option: {
        value: e.id,
        label: e.name,
        detail: [formatDayRange(e.startYmd, e.endYmd), relativeDayLabel(e.startYmd, e.endYmd, today)]
          .concat(e.hub ? ["on LiveRC"] : [])
          .join(" · "),
      },
    });
  }
  for (const j of joinable) {
    const startYmd = eventDateToYmd(j.startDate);
    const endYmd = eventDateToYmd(j.endDate);
    placed.push({
      when: placeByDate(startYmd, endYmd, today, horizon),
      startYmd,
      option: {
        value: j.id,
        label: j.name,
        detail: [
          formatDayRange(startYmd, endYmd),
          relativeDayLabel(startYmd, endYmd, today),
          j.ownerName ? `${j.ownerName}’s event` : "your team’s event",
        ]
          .concat(liveEventIds.has(j.id) ? ["on LiveRC"] : [])
          .join(" · "),
      },
    });
  }
  for (const m of live) {
    placed.push({
      when: placeByDate(m.startYmd, m.endYmd, today, horizon),
      startYmd: m.startYmd,
      option: {
        value: liveRcOptionValue(m.hubUrl),
        label: m.name,
        detail: [formatDayRange(m.startYmd, m.endYmd), relativeDayLabel(m.startYmd, m.endYmd, today), "on LiveRC"]
          .concat(m.entries && m.entries > 0 ? [`${m.entries} entries`] : [])
          .join(" · "),
      },
    });
  }

  const pick = (when: Placed["when"]) => placed.filter((p) => p.when === when);
  const byStart = (a: Placed, b: Placed) =>
    a.startYmd.localeCompare(b.startYmd) || a.option.label.localeCompare(b.option.label);

  const todayOptions = pick("today").sort(byStart).map((p) => p.option);
  const liveTodayShown =
    liveMeetings.some((m) => m.startYmd <= today && m.endYmd >= today) ||
    mine.some((e) => e.hub && e.startYmd <= today && e.endYmd >= today);
  const status: TrackEventOption | null =
    input.liveRc.status === "loading"
      ? { value: TRACK_EVENTS_STATUS_VALUE.loading, label: "Checking LiveRC…", disabled: true }
      : input.liveRc.status === "unavailable"
        ? {
            value: TRACK_EVENTS_STATUS_VALUE.unavailable,
            label: "Couldn’t reach LiveRC just now",
            disabled: true,
          }
        : input.liveRc.status === "ok" && !liveTodayShown
          ? {
              value: TRACK_EVENTS_STATUS_VALUE.nothingToday,
              label: "Nothing on LiveRC here today yet",
              disabled: true,
            }
          : null;

  const groups: TrackEventGroup[] = [
    { label: "On today", options: status ? [status, ...todayOptions] : todayOptions },
    { label: "Coming up", options: pick("soon").sort(byStart).map((p) => p.option) },
    { label: "Later", options: pick("later").sort(byStart).map((p) => p.option) },
    {
      label: "Earlier here",
      options: pick("earlier")
        .sort((a, b) => byStart(b, a))
        .slice(0, input.earlierLimit ?? 20)
        .map((p) => p.option),
    },
  ];
  return groups.filter((g) => g.options.length > 0);
}
