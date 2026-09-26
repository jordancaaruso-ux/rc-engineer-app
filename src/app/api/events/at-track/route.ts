import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { loadEventsAtTrack, loadLiveRcMeetingsOnDays } from "@/lib/events/eventsAtTrack";

export const dynamic = "force-dynamic";

/**
 * The log-run event list's LiveRC half: what's on at this track today, in the next week, and in
 * the last two weeks. Placeholder rows that span years are left out (`isLiveRcPlaceholder`).
 *
 * A POST because it can write: reading LiveRC is also the moment a hand-made event of the
 * driver's is found to be a meeting LiveRC has since posted, and linked to it (see
 * `loadEventsAtTrack`). The driver's own events and their team's still come from `/api/events`
 * and `/api/events/joinable`; the form lays all three out by day.
 *
 * Body `{ trackId }`. Answers `EventsAtTrackResult`: `{ trackId, todayYmd, aheadDays, liveRc:
 * { status, meetings }, linked }`, where each `linked` entry (`EventsAtTrackLink`) is one of the
 * driver's meetings this read joined to LiveRC's: `{ eventId, name, intoEventId, intoName,
 * liveRcName, merged, renamedTo }`.
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

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * LiveRC's meetings at this track on some days, for the New event form to point to before a
 * driver makes their own (W1-10): `?trackId=…&start=YYYY-MM-DD&end=YYYY-MM-DD`, `end` defaulting
 * to `start`. Answers `{ status: "ok" | "none" | "unavailable", meetings }`, the same meeting
 * rows as the POST. A GET because it only reads: asking never links or merges anything.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const trackId = searchParams.get("trackId")?.trim() ?? "";
  const startYmd = searchParams.get("start")?.trim() ?? "";
  const endYmd = searchParams.get("end")?.trim() || startYmd;
  if (!trackId || !YMD.test(startYmd) || !YMD.test(endYmd) || endYmd < startYmd) {
    return NextResponse.json(
      { error: "trackId, start and end (YYYY-MM-DD, end not before start) are required" },
      { status: 400 }
    );
  }

  const result = await loadLiveRcMeetingsOnDays({ trackId, startYmd, endYmd });
  if (!result) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  return NextResponse.json(result);
}
