import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET(
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

  const track = await prisma.track.findFirst({
    where: { id: trackId },
    select: { id: true, name: true, location: true, createdAt: true },
  });

  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const runCount = await prisma.run.count({
    where: { trackId },
  });

  return NextResponse.json({ track, runCount });
}

// Tracks are shared reference data; use DELETE .../favourite to remove from favourites only.

