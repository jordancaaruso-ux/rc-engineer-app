import { NextResponse, after } from "next/server";
import { revalidateAfterTrackMutation } from "@/lib/revalidateUser";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser, addTrackToFavourites } from "@/lib/track-favourites";
import { validateLiveRcTrackUrl } from "@/lib/lapWatch/liveRcTrackUrl";
import { validateSpeedhiveTrackUrl } from "@/lib/speedhive/speedhiveUrl";
import type { Prisma } from "@prisma/client";
import { communityTrackListWhere, trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import {
  DOMINANT_TRACK_ORDER_BY,
  dominantTrackByNameWhere,
} from "@/lib/tracks/trackCatalogDominance";
import { notifyAdminsOfUnverifiedAsset } from "@/lib/assets/notifyAdminReview";
import { parseCoordinates } from "@/lib/location/coordinates";
import { timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";
import { fillTrackLocation } from "@/lib/tracks/trackLocationFill";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const favouritesOnly = searchParams.get("favouritesOnly") === "1";
    const favouritesFirst = searchParams.get("favouritesFirst") === "1";
    /**
     * Opt-in cap, and opt-in on purpose. The pre-seeded catalog runs to ~1,500 rows, so the tracks
     * page asks for a page at a time — but the run form and the event editors still load the whole
     * list to filter in the browser, and defaulting to a limit would silently truncate them.
     */
    const limitParam = Number(searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 200) : null;

    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const favouriteTrackIds =
      favouritesOnly || favouritesFirst ? await getFavouriteTrackIdsForUser(user.id) : [];

    const whereBase = communityTrackListWhere(user, q);

    const tracks = await prisma.track.findMany({
      where:
        favouritesOnly && favouriteTrackIds.length > 0
          ? { ...whereBase, id: { in: favouriteTrackIds } }
          : favouritesOnly
            ? { ...whereBase, id: { in: [] } }
            : whereBase,
      // A search sorts busiest first, then by name: "newest first" is meaningless once the catalog
      // is mostly seeded rows written in one batch. Same order as the Tracks page's first screen.
      orderBy: q
        ? [{ catalogEventCount: { sort: "desc", nulls: "last" } }, { name: "asc" }]
        : { createdAt: "desc" },
      ...(limit ? { take: limit } : {}),
      select: {
        id: true,
        name: true,
        userId: true,
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
    });

    if (favouritesFirst && favouriteTrackIds.length > 0) {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const ordered: typeof tracks = [];
      for (const id of favouriteTrackIds) {
        const t = byId.get(id);
        if (t) ordered.push(t);
      }
      for (const t of tracks) {
        if (!favouriteTrackIds.includes(t.id)) ordered.push(t);
      }
      return NextResponse.json({ tracks: ordered, favouriteIds: favouriteTrackIds });
    }

    if (favouritesOnly) {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const ordered = favouriteTrackIds.map((id) => byId.get(id)).filter(Boolean) as typeof tracks;
      return NextResponse.json({ tracks: ordered, favouriteIds: favouriteTrackIds });
    }

    return NextResponse.json({ tracks, favouriteIds: favouriteTrackIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load tracks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const body = (await request.json()) as {
      name?: string;
      location?: string | null;
      liveRcUrl?: string | null;
      speedhiveUrl?: string | null;
      latitude?: unknown;
      longitude?: unknown;
      locationSource?: string | null;
      addToFavourites?: boolean;
    };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let liveRcUrl: string | null = null;
    if (typeof body.liveRcUrl === "string" && body.liveRcUrl.trim()) {
      const v = validateLiveRcTrackUrl(body.liveRcUrl);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      liveRcUrl = v.normalized;
    }

    let speedhiveUrl: string | null = null;
    if (typeof body.speedhiveUrl === "string" && body.speedhiveUrl.trim()) {
      const v = validateSpeedhiveTrackUrl(body.speedhiveUrl);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      speedhiveUrl = v.normalized;
    }

    /**
     * The pin, if whoever is adding the track knows it — they usually do, because they are
     * standing at the venue. Same vocabulary as the PATCH route, so a track created with
     * coordinates is indistinguishable from one marked afterwards.
     */
    let coordinates: { latitude: number; longitude: number; locationSource: string } | null = null;
    if (body.latitude != null || body.longitude != null) {
      const parsed = parseCoordinates(body.latitude, body.longitude);
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const src = typeof body.locationSource === "string" ? body.locationSource.trim() : "";
      coordinates = {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        locationSource: src === "manual_paste" || src === "device" ? src : "manual_paste",
      };
    }

    // The same track is the same name — or, since LiveRC-linked tracks carry LiveRC's full name
    // (2026-09-16), the same LiveRC link, or a name that IS the club's LiveRC short name
    // ("SERCCC" → serccc.liverc.com), or the same Speedhive practice track, now that the add forms
    // pick it from Speedhive's list. All exact; a looser match would silently hand a driver someone
    // else's venue, because the run form selects whatever this returns. A Speedhive ORGANISATION
    // page is not a signal: one club can run several tracks under it.
    const liveRcShort = /^[a-z0-9-]{3,40}$/i.test(name) ? name.toLowerCase() : null;
    const speedhivePractice =
      speedhiveUrl && /\/practice\/\d+$/.test(speedhiveUrl) ? speedhiveUrl : null;
    const sameTrackSignals: Prisma.TrackWhereInput[] = [
      ...(liveRcUrl ? [{ liveRcUrl: { equals: liveRcUrl, mode: "insensitive" as const } }] : []),
      ...(liveRcShort
        ? [{ liveRcUrl: { equals: `https://${liveRcShort}.liverc.com`, mode: "insensitive" as const } }]
        : []),
      ...(speedhivePractice
        ? [{ speedhiveUrl: { equals: speedhivePractice, mode: "insensitive" as const } }]
        : []),
    ];
    const byName = dominantTrackByNameWhere(name, user);
    const existing = await prisma.track.findFirst({
      where:
        sameTrackSignals.length > 0
          ? {
              AND: [
                trackCatalogScopeWhere(user),
                { OR: [{ name: byName.name }, ...sameTrackSignals] },
              ],
            }
          : byName,
      orderBy: DOMINANT_TRACK_ORDER_BY,
      select: {
        id: true,
        name: true,
        location: true,
        liveRcUrl: true,
        speedhiveUrl: true,
        gripTags: true,
        layoutTags: true,
        latitude: true,
        longitude: true,
      },
    });
    if (existing) {
      // Somebody else's row, but a pin from its timing site or town helps everyone racing there.
      if (existing.latitude == null) after(() => fillTrackLocation(existing.id).then(() => undefined));
      return NextResponse.json(
        {
          error: "This track is already in the catalog.",
          existingTrackId: existing.id,
          track: existing,
        },
        { status: 409 }
      );
    }

    const track = await prisma.track.create({
      data: {
        userId: user.id,
        name,
        location: body.location?.trim() || null,
        liveRcUrl,
        speedhiveUrl,
        ...(coordinates
          ? {
              latitude: coordinates.latitude,
              longitude: coordinates.longitude,
              locationSource: coordinates.locationSource,
              locationMarkedAt: new Date(),
              timeZone: timeZoneForCoordinates(coordinates.latitude, coordinates.longitude),
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        location: true,
        liveRcUrl: true,
        speedhiveUrl: true,
        gripTags: true,
        layoutTags: true,
        latitude: true,
        longitude: true,
      },
    });
    if (body.addToFavourites) {
      await addTrackToFavourites(user.id, track.id);
    }
    // The pin fills itself from the LiveRC address or the typed town, after the response —
    // a geocode takes seconds and the driver is mid-run (founder 2026-09-17).
    if (!coordinates) after(() => fillTrackLocation(track.id).then(() => undefined));
    revalidateAfterTrackMutation(user.id);
    await notifyAdminsOfUnverifiedAsset({
      kind: "Track",
      label: track.name,
      createdByEmail: user.email,
    });
    return NextResponse.json({ track }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create track";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
