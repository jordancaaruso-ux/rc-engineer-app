import "server-only";

import { prisma } from "@/lib/prisma";
import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { eventDateToYmd, parseEventDateYmd } from "@/lib/eventDateParse";
import { resolveTrackTimeZone } from "@/lib/tracks/trackTimeZone";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";
import { fetchLiveRcEventList } from "@/lib/lapWatch/resolveLiveRcIndexUrl";
import type { LiveRcEventListRow } from "@/lib/lapWatch/liveRcIndexHtmlParse";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import { addDaysToYmd } from "@/lib/events/joinableTeamEventLogic";
import { ensureEventParticipation, eventIdsInScopeForUser } from "@/lib/events/eventParticipation";
import { findEventByTrackAndResultsUrl } from "@/lib/events/findEventForLiveRc";
import { mergeEvents } from "@/lib/events/mergeEvents";
import {
  isDefaultEventName,
  LINK_LOOKBACK_DAYS,
  liveRcMeetingForEvent,
  offeredLiveRcMeetings,
  TRACK_EVENTS_AHEAD_DAYS,
} from "@/lib/events/liveRcMeetingMatch";
import { revalidateAfterEventMutation } from "@/lib/revalidateUser";
import type { TrackListLiveRcMeeting } from "@/lib/events/trackEventGroups";

export type EventsAtTrackResult = {
  trackId: string;
  /** Today at the track (its own clock), which the list groups around. */
  todayYmd: string;
  aheadDays: number;
  liveRc: { status: "ok" | "none" | "unavailable"; meetings: TrackListLiveRcMeeting[] };
  /**
   * The viewer's hand-made events this call matched to a LiveRC meeting. `intoEventId` differs
   * from `eventId` when the meeting already had its own event and the two became one.
   */
  linked: Array<{ eventId: string; intoEventId: string; renamedTo: string | null }>;
};

function hubOf(url: string): string {
  return normalizeLiveRcEventHubUrl(url) ?? url.trim();
}

/**
 * What's on at this track for the log-run event list, from LiveRC's events page: today, the next
 * week and the last two weeks (`offeredLiveRcMeetings`), never a placeholder row spanning years.
 *
 * Also where a hand-made event meets the LiveRC meeting that was posted after it. Most clubs only
 * put a meeting on LiveRC once the race director sets it up, so a driver's first run of the day is
 * often filed under an event they made themselves. When this read finds exactly one LiveRC meeting
 * on that event's dates, the event takes the meeting's link (and LiveRC's name, if the driver kept
 * the name the form filled in). If someone already made the meeting's own event, the two become
 * one — the same merge the Events page does when a results link is pasted — so everyone at the
 * meeting ends up on one row instead of two.
 *
 * Reads one LiveRC page per track, held five minutes and shared with the lap step. The app used to
 * read the track's LiveRC front page on every track pick for the "Racing at …?" prompt; LiveRC's
 * front pages no longer link the running meeting, so that read found nothing (checked 26 Sep 2026
 * on emcc, rrcsa and trc, EMCC mid-meeting). This one replaces it.
 */
export async function loadEventsAtTrack(input: {
  userId: string;
  trackId: string;
  now?: Date;
}): Promise<EventsAtTrackResult | null> {
  const [track, owner] = await Promise.all([
    prisma.track.findFirst({
      where: { id: input.trackId },
      select: {
        id: true,
        name: true,
        liveRcUrl: true,
        timeZone: true,
        latitude: true,
        longitude: true,
      },
    }),
    prisma.user.findUnique({ where: { id: input.userId }, select: { timeZone: true } }),
  ]);
  if (!track) return null;

  // "Today" is the track's day, not the server's (UTC on Vercel) — 8 am race morning in Melbourne
  // is still yesterday in UTC.
  const todayYmd = calendarYmdInTimeZone(
    input.now ?? new Date(),
    resolveTrackTimeZone(track, owner),
  );
  const base = { trackId: track.id, todayYmd, aheadDays: TRACK_EVENTS_AHEAD_DAYS, linked: [] };

  const origin = track.liveRcUrl ? normalizeLiveRcTrackOrigin(track.liveRcUrl) : null;
  if (!origin) return { ...base, liveRc: { status: "none", meetings: [] } };

  const list = await fetchLiveRcEventList(origin);
  if (!list.ok) return { ...base, liveRc: { status: "unavailable", meetings: [] } };

  const linked = await linkHandMadeEventsToLiveRc({
    userId: input.userId,
    track,
    todayYmd,
    rows: list.events,
  });

  const offered = offeredLiveRcMeetings(list.events, todayYmd, TRACK_EVENTS_AHEAD_DAYS);
  const claimed = await prisma.event.findMany({
    where: { trackId: track.id, resultsSourceUrl: { not: null } },
    select: { id: true, resultsSourceUrl: true },
    orderBy: { createdAt: "asc" },
  });
  const eventIdByHub = new Map<string, string>();
  for (const row of claimed) {
    const hub = hubOf(row.resultsSourceUrl!);
    if (!eventIdByHub.has(hub)) eventIdByHub.set(hub, row.id);
  }

  return {
    ...base,
    linked,
    liveRc: {
      status: "ok",
      meetings: offered.map((m) => {
        const hub = hubOf(m.eventHubUrl);
        return {
          hubUrl: hub,
          name: m.name,
          startYmd: m.startYmd,
          endYmd: m.endYmd,
          entries: m.entries ?? null,
          eventId: eventIdByHub.get(hub) ?? null,
        };
      }),
    },
  };
}

/**
 * The viewer's events at this track that carry no LiveRC link yet and sit near today, each matched
 * to the one LiveRC meeting on its dates (`liveRcMeetingForEvent` refuses to guess between two).
 */
async function linkHandMadeEventsToLiveRc(input: {
  userId: string;
  track: { id: string; name: string };
  todayYmd: string;
  rows: LiveRcEventListRow[];
}): Promise<EventsAtTrackResult["linked"]> {
  const scoped = await eventIdsInScopeForUser(input.userId);
  if (scoped.length === 0) return [];

  const windowStart = parseEventDateYmd(addDaysToYmd(input.todayYmd, -LINK_LOOKBACK_DAYS));
  const windowEnd = parseEventDateYmd(addDaysToYmd(input.todayYmd, TRACK_EVENTS_AHEAD_DAYS));
  const candidates = await prisma.event.findMany({
    where: {
      id: { in: scoped },
      trackId: input.track.id,
      resultsSourceUrl: null,
      startDate: { lte: windowEnd },
      endDate: { gte: windowStart },
    },
    select: { id: true, name: true, startDate: true, endDate: true, trackNameSnapshot: true },
  });

  const linked: EventsAtTrackResult["linked"] = [];
  for (const ev of candidates) {
    const startYmd = eventDateToYmd(ev.startDate);
    const meeting = liveRcMeetingForEvent({ startYmd, endYmd: eventDateToYmd(ev.endDate) }, input.rows);
    if (!meeting) continue;
    const hub = hubOf(meeting.eventHubUrl);
    try {
      const existing = await findEventByTrackAndResultsUrl(input.track.id, hub);
      if (existing && existing.id !== ev.id) {
        await mergeEvents({ winnerId: existing.id, loserId: ev.id });
        await ensureEventParticipation({ userId: input.userId, eventId: existing.id });
        linked.push({ eventId: ev.id, intoEventId: existing.id, renamedTo: null });
        continue;
      }
      const renamedTo = isDefaultEventName(ev.name, [input.track.name, ev.trackNameSnapshot], startYmd)
        ? meeting.name
        : null;
      // The meeting's days join the event's: a Saturday event linked to a Friday-to-Sunday meeting
      // reads "day 2 of 3", and a Friday practice run already on it keeps its day.
      const endYmd = eventDateToYmd(ev.endDate);
      const nextStart = meeting.startYmd < startYmd ? meeting.startYmd : startYmd;
      const nextEnd = meeting.endYmd > endYmd ? meeting.endYmd : endYmd;
      await prisma.event.update({
        where: { id: ev.id },
        data: {
          resultsSourceUrl: hub,
          ...(renamedTo ? { name: renamedTo } : {}),
          ...(nextStart !== startYmd ? { startDate: parseEventDateYmd(nextStart) } : {}),
          ...(nextEnd !== endYmd ? { endDate: parseEventDateYmd(nextEnd) } : {}),
        },
      });
      linked.push({ eventId: ev.id, intoEventId: ev.id, renamedTo });
    } catch (err) {
      // One event that can't be linked (merged away by a teammate's read a moment ago) must not
      // cost the driver the list itself; the next read tries again.
      console.warn("[events/at-track] link skipped", ev.id, err);
    }
  }

  if (linked.length > 0) revalidateAfterEventMutation(input.userId);
  return linked;
}
