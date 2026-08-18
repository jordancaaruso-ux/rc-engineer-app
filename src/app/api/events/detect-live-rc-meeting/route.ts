import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { detectActiveRaceMeetingAtTrack } from "@/lib/lapWatch/detectActiveRaceMeetingAtTrack";
import {
  buildLiveRcMeetingDetectionPayload,
  normalizeLiveRcEventHubUrl,
} from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import { findEventByTrackAndResultsUrl, findPlannedEventAtTrack } from "@/lib/events/findEventForLiveRc";
import { hasTeamAccess } from "@/lib/teamAccess";
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";

export const dynamic = "force-dynamic";

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

  const liveRcUrl = track.liveRcUrl?.trim() ?? "";
  if (!liveRcUrl) {
    return NextResponse.json({
      detected: false,
      code: "missing_live_rc_url",
      error: "This track has no LiveRC URL.",
    });
  }

  const referenceDate = new Date();
  const meeting = await detectActiveRaceMeetingAtTrack({
    trackLiveRcUrl: liveRcUrl,
    referenceDate,
  });

  if (!meeting.detected || !meeting.eventHubUrl) {
    return NextResponse.json({ detected: false, trackId });
  }

  const eventHubUrl = normalizeLiveRcEventHubUrl(meeting.eventHubUrl);
  if (!eventHubUrl) {
    return NextResponse.json({ detected: false, trackId });
  }

  const existing = await findEventByTrackAndResultsUrl(trackId, eventHubUrl);
  const planned = existing
    ? null
    : await findPlannedEventAtTrack({
        viewerId: userId,
        trackId,
        referenceDate,
        eventHubUrl,
      });
  const matchedEventId = existing?.id ?? planned?.id ?? null;

  // The prompt has to name the event it is actually going to apply, not LiveRC's label for the
  // meeting. Only a teammate is named alongside it: `loadTeamMemberDisplays` falls back to the
  // account email, which must never be shown for a stranger whose event we matched on results URL.
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

  const payload = buildLiveRcMeetingDetectionPayload({
    eventLabel: meeting.eventLabel,
    eventHubUrl,
    trackLiveRcUrl: liveRcUrl,
    matchedEventId,
    matchedEventName: matchedEvent?.name ?? null,
    matchedEventOwnerName,
  });

  if (!payload) {
    return NextResponse.json({ detected: false, trackId });
  }

  return NextResponse.json({
    trackId,
    trackName: track.name,
    ...payload,
    matchedPlannedEventId: planned?.id ?? null,
  });
}
