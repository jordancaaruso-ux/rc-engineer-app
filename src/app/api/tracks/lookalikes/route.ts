import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { trackLookalikeFinder } from "@/lib/tracks/trackLookalike";

/**
 * Tracks already in the catalog that the name being typed in an add-track form plainly means, so
 * the form can offer the existing club before a near-copy is made (founder ruling 2026-09-26).
 *
 *   GET /api/tracks/lookalikes?name=Knox%20Offroad&location=Knoxfield
 *
 * Read-only and advisory: POST /api/tracks keeps its own exact checks, and the form always keeps a
 * way to make the new track ("No, it's a different club"). Rules: src/lib/tracks/trackLookalike.ts.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const name = params.get("name")?.trim().slice(0, 80) ?? "";
  const location = params.get("location")?.trim().slice(0, 80) || null;
  if (name.length < 3) return NextResponse.json({ lookalikes: [] });

  const scope = trackCatalogScopeWhere(user);
  const [rows, ownTracks] = await Promise.all([
    prisma.track.findMany({
      where: scope,
      select: {
        id: true,
        name: true,
        location: true,
        region: true,
        countryCode: true,
        liveRcUrl: true,
        speedhiveUrl: true,
        catalogEventCount: true,
      },
    }),
    // The countries this driver races in, as the Tracks page works them out: favourites and runs.
    prisma.track.findMany({
      where: {
        ...scope,
        OR: [
          { favouriteTracks: { some: { userId: user.id } } },
          { runs: { some: { userId: user.id, hiddenByPlanAt: null } } },
        ],
      },
      select: { countryCode: true },
    }),
  ]);
  const homeCountries = [...new Set(ownTracks.map((t) => t.countryCode).filter((c): c is string => !!c))];

  const lookalikes = trackLookalikeFinder(rows)(name, { location, homeCountries }).map(({ row, why }) => ({
    id: row.id,
    name: row.name,
    location: row.location ?? null,
    liveRcUrl: row.liveRcUrl ?? null,
    speedhiveUrl: row.speedhiveUrl ?? null,
    why,
  }));

  return NextResponse.json({ lookalikes });
}
