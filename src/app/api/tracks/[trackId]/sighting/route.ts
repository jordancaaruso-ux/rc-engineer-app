import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { parseCoordinates } from "@/lib/location/coordinates";
import { recordTrackSighting } from "@/lib/tracks/trackLocationFill";

/**
 * Where the driver's phone was when they logged a run at this track. Sent quietly after a save,
 * only when location permission was already granted — see `recordTrackSighting` for what happens
 * to it. The response says nothing a driver needs to see.
 *
 *   POST /api/tracks/:trackId/sighting   { latitude, longitude }
 */
export async function POST(request: Request, context: { params: Promise<{ trackId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { trackId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    latitude?: unknown;
    longitude?: unknown;
  } | null;
  const position = parseCoordinates(body?.latitude, body?.longitude);
  if ("error" in position) return NextResponse.json({ error: position.error }, { status: 400 });

  const outcome = await recordTrackSighting({ userId, trackId, position });
  return NextResponse.json({ outcome });
}
