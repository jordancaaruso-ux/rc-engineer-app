import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";

export async function POST(
  _request: Request,
  context: { params: Promise<{ trackId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const { trackId } = await context.params;
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const track = await prisma.track.findFirst({
    where: communityTrackByIdWhere(trackId),
    select: { id: true },
  });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  await prisma.trackLocationRunPromptDismissal.upsert({
    where: { userId_trackId: { userId: user.id, trackId } },
    create: { userId: user.id, trackId },
    update: { dismissedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}