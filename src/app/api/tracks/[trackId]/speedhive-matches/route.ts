import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { fetchRcPracticeDirectory } from "@/lib/speedhive/speedhivePracticeDirectory";
import { rankPracticeLocations } from "@/lib/speedhive/matchPracticeLocations";

/**
 * Speedhive practice locations that look like this track — "Find on Speedhive".
 *
 *   GET /api/tracks/:trackId/speedhive-matches          → ranked against the track's own name
 *   GET /api/tracks/:trackId/speedhive-matches?q=words  → the driver's own words instead
 *
 * Read-only. Picking a match saves through the ordinary PATCH on the track, which any driver may
 * do for timing links.
 */
export async function GET(request: Request, context: { params: Promise<{ trackId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { trackId } = await context.params;
  const track = await prisma.track.findFirst({
    where: communityTrackByIdWhere(trackId),
    select: { name: true, location: true, countryCode: true },
  });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) || null;

  let rows;
  try {
    rows = await fetchRcPracticeDirectory();
  } catch {
    return NextResponse.json({ error: "Couldn't reach Speedhive just now." }, { status: 502 });
  }

  const matches = rankPracticeLocations(
    rows,
    q ? { name: q, location: null, countryCode: track.countryCode } : track
  ).map(({ id, name, countryCode, url }) => ({ id, name, countryCode, url }));

  return NextResponse.json({ matches });
}
