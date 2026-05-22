import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { buildWorkerConfig } from "@/lib/videoAnalysis/exportWorkerConfig";

type Params = { params: Promise<{ profileId: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profileId } = await params;

  const profile = await prisma.trackCameraProfile.findFirst({
    where: { id: profileId, userId: user.id },
    include: {
      sectorLines: { orderBy: { sortOrder: "asc" } },
      track: { select: { id: true, name: true } },
    },
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const workerConfig = buildWorkerConfig(profile.sectorLines, {
    referenceFramePath: profile.referenceImagePath,
  });

  return NextResponse.json({ profile, workerConfig });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profileId } = await params;

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    referenceImagePath?: string | null;
    lastAlignmentJson?: unknown;
  } | null;

  const existing = await prisma.trackCameraProfile.findFirst({
    where: { id: profileId, userId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const profile = await prisma.trackCameraProfile.update({
    where: { id: profileId },
    data: {
      ...(body?.name != null ? { name: body.name.trim().slice(0, 80) } : {}),
      ...(body?.referenceImagePath !== undefined
        ? { referenceImagePath: body.referenceImagePath }
        : {}),
      ...(body?.lastAlignmentJson !== undefined
        ? { lastAlignmentJson: body.lastAlignmentJson as object }
        : {}),
    },
    include: { sectorLines: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json({ profile });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profileId } = await params;

  const existing = await prisma.trackCameraProfile.findFirst({
    where: { id: profileId, userId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.trackCameraProfile.delete({ where: { id: profileId } });
  return NextResponse.json({ ok: true });
}
