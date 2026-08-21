import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { parseCoordinates } from "@/lib/location/coordinates";
import { haversineMeters, sortNearbyTracks } from "@/lib/location/trackProximity";

/**
 * Tracks near a position, nearest first.
 *
 * Exists because the catalog is no longer small enough to answer this in the browser. The run
 * form's nearby prompt loads every track and measures them client-side, which was fine at a few
 * hundred rows and is not at ~1,500 — so browsing "near you" asks the server, which can throw
 * away everything outside a bounding box before it measures anything.
 *
 * The radius here is a BROWSE radius (tens of km: "what can I race at this weekend"), quite
 * separate from DEFAULT_TRACK_PROXIMITY_RADIUS_M (800m: "you are standing at this track, shall I
 * select it"). Keeping them apart matters — widening the auto-select radius would start attaching
 * runs to the wrong venue.
 */
const DEFAULT_RADIUS_M = 50_000;
const MAX_RADIUS_M = 500_000;
const MAX_RESULTS = 20;

/** Rough degrees-per-metre, generous at high latitude so the box never clips a real hit. */
function boundingBox(latitude: number, longitude: number, radiusM: number) {
  const latDelta = radiusM / 111_320;
  const cos = Math.cos((latitude * Math.PI) / 180);
  const lonDelta = radiusM / (111_320 * Math.max(0.05, Math.abs(cos)));
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLon: longitude - lonDelta,
    maxLon: longitude + lonDelta,
  };
}

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const position = parseCoordinates(
      Number(searchParams.get("lat")),
      Number(searchParams.get("lon"))
    );
    if ("error" in position) {
      return NextResponse.json({ error: position.error }, { status: 400 });
    }

    const requested = Number(searchParams.get("radiusM"));
    const radiusM =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_RADIUS_M)
        : DEFAULT_RADIUS_M;

    const box = boundingBox(position.latitude, position.longitude, radiusM);

    const [rows, favouriteTrackIds] = await Promise.all([
      prisma.track.findMany({
        where: {
          ...trackCatalogScopeWhere(user),
          latitude: { gte: box.minLat, lte: box.maxLat },
          longitude: { gte: box.minLon, lte: box.maxLon },
        },
        select: {
          id: true,
          name: true,
          location: true,
          countryCode: true,
          region: true,
          latitude: true,
          longitude: true,
          liveRcUrl: true,
          speedhiveUrl: true,
          gripTags: true,
          layoutTags: true,
        },
        // The box is a coarse pre-filter; the real cut is the circle below. Cap it so a driver in
        // a dense area can't pull thousands of rows through the measurement.
        take: 400,
      }),
      getFavouriteTrackIdsForUser(user.id),
    ]);

    const nearby = rows
      .filter((t) => t.latitude != null && t.longitude != null)
      .map((track) => ({
        track,
        distanceM: haversineMeters(position, {
          latitude: track.latitude!,
          longitude: track.longitude!,
        }),
      }))
      .filter((hit) => hit.distanceM <= radiusM);

    // Reuses the app's own ordering rule (favourites first, then ascending distance) so browsing
    // and the run form's nearby prompt can never disagree about what "closest" means.
    const sorted = sortNearbyTracks(nearby, favouriteTrackIds).slice(0, MAX_RESULTS);

    // sortNearbyTracks narrows `track` to the coordinate fields it needs, so come back through the
    // full rows by id rather than shipping a thinner object than the client was promised.
    const byId = new Map(rows.map((t) => [t.id, t]));

    return NextResponse.json({
      tracks: sorted.map((hit) => ({
        ...byId.get(hit.track.id)!,
        distanceM: Math.round(hit.distanceM),
      })),
      favouriteIds: favouriteTrackIds,
      radiusM,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load nearby tracks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
