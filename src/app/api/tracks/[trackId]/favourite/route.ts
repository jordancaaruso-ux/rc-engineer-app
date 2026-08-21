import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { removeTrackFavourite, toggleTrackFavourite } from "@/lib/track-favourites";
import { revalidateAfterTrackMutation } from "@/lib/revalidateUser";

/**
 * Favourites are now set from the catalog list, not only from a track's own page, so this
 * fires far more often — and the Paddock tracks band leads on favourites. Paths alone left
 * that band up to 30s stale (it rides `getCachedPaddockModel`, which is tagged, not pathed),
 * so a driver could star a track and come back to "No favourites yet".
 */
function revalidateFavouritePaths(userId: string, trackId: string) {
  revalidateAfterTrackMutation(userId);
  revalidatePath("/paddock");
  revalidatePath(`/tracks/${trackId}`);
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ trackId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const { trackId } = await context.params;
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const track = await prisma.track.findFirst({ where: { id: trackId }, select: { id: true } });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }
  const result = await toggleTrackFavourite(userId, trackId);
  if ("error" in result) {
    if (process.env.NODE_ENV === "development") console.error("[favourite POST]", result.error);
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? result.error : "Could not update favourite" },
      { status: 503 }
    );
  }
  revalidateFavouritePaths(userId, trackId);
  return NextResponse.json({ ok: true, added: result.added });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ trackId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const { trackId } = await context.params;
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await removeTrackFavourite(userId, trackId);
  if (!result.ok) {
    if (process.env.NODE_ENV === "development") console.error("[favourite DELETE]", result.error);
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? result.error : "Could not update favourite" },
      { status: 503 }
    );
  }
  revalidateFavouritePaths(userId, trackId);
  return NextResponse.json({ ok: true });
}
