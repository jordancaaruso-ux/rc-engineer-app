import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser, addTrackToFavourites } from "@/lib/track-favourites";

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

    const user = await getOrCreateLocalUser();
    const favouriteTrackIds =
      favouritesOnly || favouritesFirst ? await getFavouriteTrackIdsForUser(user.id) : [];

    const where = q
      ? {
          OR: [
            { name: { contains: q } },
            { location: { contains: q } },
          ],
        }
      : {};

    const tracks = await prisma.track.findMany({
      where: favouritesOnly && favouriteTrackIds.length > 0
        ? Object.keys(where).length > 0
          ? { id: { in: favouriteTrackIds }, ...where }
          : { id: { in: favouriteTrackIds } }
        : favouritesOnly
          ? { id: { in: [] } }
          : where,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, location: true },
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
      addToFavourites?: boolean;
    };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }
    const track = await prisma.track.create({
      data: {
        name,
        location: body.location?.trim() || null,
      },
      select: { id: true, name: true, location: true },
    });
    if (body.addToFavourites) {
      const user = await getOrCreateLocalUser();
      await addTrackToFavourites(user.id, track.id);
    }
    revalidatePath("/tracks");
    revalidatePath("/runs/new");
    return NextResponse.json({ track }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create track";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
