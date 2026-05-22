import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";

type Params = { params: Promise<{ profileId: string }> };

type SectorInput = {
  lineKey: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sortOrder?: number;
};

export async function PUT(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profileId } = await params;

  const profile = await prisma.trackCameraProfile.findFirst({
    where: { id: profileId, userId: user.id },
    select: { id: true },
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { lines?: SectorInput[] } | null;
  const lines = body?.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: "lines array required" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.trackSectorLine.deleteMany({ where: { profileId } }),
    prisma.trackSectorLine.createMany({
      data: lines.map((l, i) => ({
        profileId,
        lineKey: l.lineKey.slice(0, 32),
        label: l.label.slice(0, 80),
        x1: clamp01(l.x1),
        y1: clamp01(l.y1),
        x2: clamp01(l.x2),
        y2: clamp01(l.y2),
        sortOrder: l.sortOrder ?? i,
      })),
    }),
  ]);

  const sectorLines = await prisma.trackSectorLine.findMany({
    where: { profileId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ sectorLines });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
