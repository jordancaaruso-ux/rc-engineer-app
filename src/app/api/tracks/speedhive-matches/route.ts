import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { fetchRcPracticeDirectory } from "@/lib/speedhive/speedhivePracticeDirectory";
import { rankPracticeLocations } from "@/lib/speedhive/matchPracticeLocations";

/**
 * "Find on Speedhive" for a track that isn't saved yet — the add-track forms, where the driver has
 * typed a name and maybe a town. The saved-track version is `[trackId]/speedhive-matches`.
 *
 *   GET /api/tracks/speedhive-matches?name=words&location=town
 *
 * Read-only: the picked link goes in with the new track's own POST.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const name = params.get("name")?.trim().slice(0, 80) || null;
  const location = params.get("location")?.trim().slice(0, 80) || null;
  if (!name) return NextResponse.json({ error: "Type the track's name first." }, { status: 400 });

  let rows;
  try {
    rows = await fetchRcPracticeDirectory();
  } catch {
    return NextResponse.json({ error: "Couldn't reach Speedhive just now." }, { status: 502 });
  }

  const matches = rankPracticeLocations(rows, { name, location }).map(
    ({ id, name, countryCode, url }) => ({ id, name, countryCode, url })
  );

  return NextResponse.json({ matches });
}
