import { NextResponse } from "next/server";
import { revalidateAfterTrackMutation } from "@/lib/revalidateUser";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser, addTrackToFavourites } from "@/lib/track-favourites";
import { validateLiveRcTrackUrl } from "@/lib/lapWatch/liveRcTrackUrl";
import { validateSpeedhiveTrackUrl } from "@/lib/speedhive/speedhiveUrl";
import { communityTrackListWhere } from "@/lib/tracks/communityTrackAccess";
import {
  DOMINANT_TRACK_ORDER_BY,
  dominantTrackByNameWhere,
} from "@/lib/tracks/trackCatalogDominance";

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

    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const favouriteTrackIds =
      favouritesOnly || favouritesFirst ? await getFavouriteTrackIdsForUser(user.id) : [];

    const whereBase = communityTrackListWhere(q);

    const tracks = await prisma.track.findMany({
      where:
        favouritesOnly && favouriteTrackIds.length > 0
          ? { ...whereBase, id: { in: favouriteTrackIds } }
          : favouritesOnly
            ? { ...whereBase, id: { in: [] } }
            : whereBase,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        location: true,
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

    const existing = await prisma.track.findFirst({
      where: dominantTrackByNameWhere(name),
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
      return NextResponse.json(
        {
          error: "A track with this name already exists in the community catalog.",
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
    revalidateAfterTrackMutation(user.id);
    return NextResponse.json({ track }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create track";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
