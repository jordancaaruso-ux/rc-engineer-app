import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { detectActiveRaceMeetingAtTrack } from "@/lib/lapWatch/detectActiveRaceMeetingAtTrack";
import {
  buildLiveRcMeetingDetectionPayload,
  normalizeLiveRcEventHubUrl,
} from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import { findEventByTrackAndResultsUrl, findPlannedEventAtTrack } from "@/lib/events/findEventForLiveRc";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
        trackId,
        referenceDate,
        eventHubUrl,
      });
  const matchedEventId = existing?.id ?? planned?.id ?? null;

  const payload = buildLiveRcMeetingDetectionPayload({
    eventLabel: meeting.eventLabel,
    eventHubUrl,
    trackLiveRcUrl: liveRcUrl,
    matchedEventId,
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
