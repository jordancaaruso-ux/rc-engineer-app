import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";

export async function POST(
  _request: Request,
  context: { params: Promise<{ trackId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const { trackId } = await context.params;
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const track = await prisma.track.findFirst({
    where: communityTrackByIdWhere(trackId),
    select: { id: true },
  });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  await prisma.trackLocationRunPromptDismissal.upsert({
    where: { userId_trackId: { userId: userId, trackId } },
    create: { userId: userId, trackId },
    update: { dismissedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}