import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { loadEventsAtTrack } from "@/lib/events/eventsAtTrack";

export const dynamic = "force-dynamic";

/**
 * The log-run event list's LiveRC half: what's on at this track today, in the next week, and in
 * the last two weeks. Placeholder rows that span years are left out (`isLiveRcPlaceholder`).
 *
 * A POST because it can write: reading LiveRC is also the moment a hand-made event of the
 * driver's is found to be a meeting LiveRC has since posted, and linked to it (see
 * `loadEventsAtTrack`). The driver's own events and their team's still come from `/api/events`
 * and `/api/events/joinable`; the form lays all three out by day.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { trackId?: unknown } | null;
  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";
  if (!trackId) return NextResponse.json({ error: "trackId is required" }, { status: 400 });

  const result = await loadEventsAtTrack({ userId, trackId });
  if (!result) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  return NextResponse.json(result);
}
