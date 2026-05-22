import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";

type Params = { params: Promise<{ trackId: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { trackId } = await params;

  const track = await prisma.track.findFirst({
    where: { id: trackId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const profiles = await prisma.trackCameraProfile.findMany({
    where: { trackId, userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      sectorLines: { orderBy: { sortOrder: "asc" } },
    },
  });

  return NextResponse.json({ track, profiles });
}

export async function POST(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { trackId } = await params;

  const track = await prisma.track.findFirst({
    where: { id: trackId, userId: user.id },
    select: { id: true },
  });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim()?.slice(0, 80) || "Main camera";

  const profile = await prisma.trackCameraProfile.create({
    data: {
      userId: user.id,
      trackId,
      name,
      sectorLines: {
        create: [
          {
            lineKey: "sf",
            label: "Start / Finish",
            x1: 0.35,
            y1: 0.72,
            x2: 0.65,
            y2: 0.72,
            sortOrder: 0,
          },
        ],
      },
    },
    include: { sectorLines: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json({ profile }, { status: 201 });
}
