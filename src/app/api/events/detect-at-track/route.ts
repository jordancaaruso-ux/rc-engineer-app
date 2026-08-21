import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { detectActiveRaceMeetingAtTrack } from "@/lib/lapWatch/detectActiveRaceMeetingAtTrack";
import {
  defaultEventNameFromLiveRcLabel,
  normalizeLiveRcEventHubUrl,
} from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";
import { findEventByTrackAndResultsUrl } from "@/lib/events/findEventForLiveRc";
import { findJoinableTeamEventAtTrack } from "@/lib/events/findJoinableTeamEvent";
import { hasTeamAccess } from "@/lib/teamAccess";
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";

export const dynamic = "force-dynamic";

/**
 * "Is there an event here I should be on?" — asked of our own diary first, and of LiveRC only as an
 * optional extra.
 *
 * This route used to be `detect-live-rc-meeting`, and the order was the other way round: it gave up
 * before opening the database unless the track carried a LiveRC URL *and* LiveRC reported a meeting
 * running today. The team-event lookup was the last link in that chain, so a teammate's event was
 * unreachable at every track LiveRC has never heard of — which is most of them. Club days, MyRCM and
 * Speedhive tracks and untimed bashes are not edge cases, and an event nobody can find is an event
 * nobody joins, so the two questions are now independent and either one alone can produce an offer.
 *
 * LiveRC still earns its place twice over when it is available: its results URL is a public identity
 * claim that lets two strangers at the same meeting land on one row (`findEventByTrackAndResultsUrl`,
 * deliberately NOT team-scoped), and it supplies a real name for an event nobody has booked yet.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { trackId?: string } | null;
  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";
  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  const track = await prisma.track.findFirst({
    where: communityTrackByIdWhere(trackId),
    select: { id: true, name: true, liveRcUrl: true },
  });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const referenceDate = new Date();
  const liveRcUrl = track.liveRcUrl?.trim() ?? "";

  // Only reached for tracks that actually have a LiveRC page. A missing URL is no longer an early
  // return — it just means this half of the answer is empty.
  const meeting = liveRcUrl
    ? await detectActiveRaceMeetingAtTrack({ trackLiveRcUrl: liveRcUrl, referenceDate })
    : null;
  const eventHubUrl =
    meeting?.detected && meeting.eventHubUrl
      ? normalizeLiveRcEventHubUrl(meeting.eventHubUrl)
      : null;

  // Strongest first: someone — anyone — already logged this exact meeting.
  const existing = eventHubUrl
    ? await findEventByTrackAndResultsUrl(trackId, eventHubUrl)
    : null;

  // Then our own diary. Passing the hub (when we have one) keeps an event claiming a DIFFERENT
  // LiveRC meeting from being offered as this one.
  const teamMatch = existing
    ? null
    : await findJoinableTeamEventAtTrack({
        viewerId: userId,
        trackId,
        referenceDate,
        eventHubUrl,
      });

  const matchedEventId = existing?.id ?? teamMatch?.id ?? null;
  if (!matchedEventId && !eventHubUrl) {
    return NextResponse.json({ detected: false, trackId });
  }

  // Name the event we are actually going to apply, not LiveRC's label for the meeting. Only a
  // teammate is named alongside it: `loadTeamMemberDisplays` falls back to the account email, which
  // must never be shown for a stranger whose event we matched on results URL.
  const matchedEvent = matchedEventId
    ? await prisma.event.findUnique({
        where: { id: matchedEventId },
        select: { name: true, userId: true },
      })
    : null;
  let matchedEventOwnerName: string | null = null;
  if (
    matchedEvent?.userId &&
    matchedEvent.userId !== userId &&
    (await hasTeamAccess(userId, matchedEvent.userId))
  ) {
    const displays = await loadTeamMemberDisplays([matchedEvent.userId], userId);
    matchedEventOwnerName = displays.get(matchedEvent.userId)?.name ?? null;
  }

  return NextResponse.json({
    detected: true,
    trackId,
    trackName: track.name,
    // Null whenever LiveRC had nothing (or the track has no LiveRC page). The prompt reads this to
    // decide whether "Make my own" — which forks a fresh event off LiveRC's name — is even possible.
    eventHubUrl,
    eventLabel: eventHubUrl
      ? defaultEventNameFromLiveRcLabel(meeting?.eventLabel ?? null, track.name)
      : null,
    trackOrigin: liveRcUrl ? normalizeLiveRcTrackOrigin(liveRcUrl) : null,
    matchedEventId,
    matchedEventName: matchedEvent?.name ?? null,
    matchedEventOwnerName,
    /** The match is a same-track-this-week guess, not a results-URL identity claim. */
    matchedIsPlanned: Boolean(teamMatch),
    /** False when the match is booked for later in the week rather than running now. */
    matchedIsOnToday: teamMatch ? teamMatch.isOnToday : Boolean(matchedEventId),
    matchedStartDate: teamMatch ? teamMatch.startDate.toISOString() : null,
    matchedEndDate: teamMatch ? teamMatch.endDate.toISOString() : null,
  });
}
