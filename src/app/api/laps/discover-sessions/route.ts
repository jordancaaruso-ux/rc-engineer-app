import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { discoverTrackTimingSessions } from "@/lib/lapWatch/discoverTrackTimingSessions";

export const dynamic = "force-dynamic";

/**
 * Discover the user's most recent timing sessions at a track (LiveRC and/or Speedhive).
 * Does not set run type — lap import only.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { trackId?: string; eventId?: string | null; referenceDate?: string | null }
    | null;

  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";
  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  const track = await prisma.track.findFirst({
    where: { id: trackId },
    select: { liveRcUrl: true, speedhiveUrl: true },
  });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }
  const liveRcUrl = track.liveRcUrl?.trim() ?? "";
  const speedhiveUrl = track.speedhiveUrl?.trim() ?? "";
  if (!liveRcUrl && !speedhiveUrl) {
    return NextResponse.json(
      {
        error:
          "This track has no LiveRC or Speedhive URL. Add at least one on the Tracks page.",
        code: "missing_timing_url",
      },
      { status: 400 }
    );
  }

  let eventRaceClass: string | null = null;
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (eventId) {
    const ev = await prisma.event.findFirst({
      where: { id: eventId, userId: user.id },
      select: { raceClass: true },
    });
    eventRaceClass = ev?.raceClass?.trim() || null;
  }

  let referenceDate: Date | undefined;
  if (typeof body?.referenceDate === "string" && body.referenceDate.trim()) {
    const d = new Date(body.referenceDate.trim());
    if (!Number.isNaN(d.getTime())) referenceDate = d;
  }

  const result = await discoverTrackTimingSessions({
    userId: user.id,
    liveRcUrl: liveRcUrl || null,
    speedhiveUrl: speedhiveUrl || null,
    eventRaceClass,
    referenceDate,
  });

  return NextResponse.json({
    ok: true,
    trackId,
    candidates: result.candidates,
    unimportedCandidates: result.unimportedCandidates,
    mostRecentSession: result.mostRecentSession,
    hint: result.hint,
    liveRcDriverName: result.liveRcDriverName,
    debug: result.liveRcDebug,
    speedhiveOrganizationId: result.speedhiveOrganizationId,
    activeRaceMeeting: result.activeRaceMeeting,
    hasLiveRc: Boolean(liveRcUrl),
    hasSpeedhive: Boolean(speedhiveUrl),
  });
}
