import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { toggleTrackFavourite } from "@/lib/track-favourites";

function revalidateFavouritePaths(trackId: string) {
  revalidatePath("/tracks");
  revalidatePath("/runs/new");
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
  const track = await prisma.track.findFirst({ where: { id: trackId }, select: { id: true } });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }
  const user = await getOrCreateLocalUser();
  const result = await toggleTrackFavourite(user.id, trackId);
  if ("error" in result) {
    if (process.env.NODE_ENV === "development") console.error("[favourite POST]", result.error);
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? result.error : "Could not update favourite" },
      { status: 503 }
    );
  }
  revalidateFavouritePaths(trackId);
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
  const user = await getOrCreateLocalUser();
  const result = await removeTrackFavourite(user.id, trackId);
  if (!result.ok) {
    if (process.env.NODE_ENV === "development") console.error("[favourite DELETE]", result.error);
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? result.error : "Could not update favourite" },
      { status: 503 }
    );
  }
  revalidateFavouritePaths(trackId);
  return NextResponse.json({ ok: true });
}
