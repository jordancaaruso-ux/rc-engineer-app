import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { discoverLiveRcSessionsForUser } from "@/lib/lapWatch/discoverLiveRcSessionsForUser";

export const dynamic = "force-dynamic";

/**
 * Discover the user's most recent LiveRC sessions at a track (practice + race, unified by time).
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
    select: { liveRcUrl: true },
  });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }
  const liveRcUrl = track.liveRcUrl?.trim() ?? "";
  if (!liveRcUrl) {
    return NextResponse.json(
      {
        error: "This track has no LiveRC URL. Add one on the Tracks page.",
        code: "missing_live_rc_url",
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

  const result = await discoverLiveRcSessionsForUser({
    userId: user.id,
    trackLiveRcUrl: liveRcUrl,
    eventRaceClass,
    referenceDate,
  });

  return NextResponse.json({ ok: true, trackId, ...result });
}
