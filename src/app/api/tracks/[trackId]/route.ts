import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { normalizeGripTags, normalizeLayoutTags } from "@/lib/trackMetaTags";

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
  const user = await getOrCreateLocalUser();

  const track = await prisma.track.findFirst({
    where: { id: trackId, userId: user.id },
    select: { id: true, name: true, location: true, gripTags: true, layoutTags: true, createdAt: true },
  });

  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const runCount = await prisma.run.count({
    where: { trackId, userId: user.id },
  });

  return NextResponse.json({ track, runCount });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ trackId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { trackId } = await context.params;
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => null)) as {
    gripTags?: unknown;
    layoutTags?: unknown;
  } | null;

  const existing = await prisma.track.findFirst({
    where: { id: trackId, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const data: { gripTags?: string[]; layoutTags?: string[] } = {};
  if (body && "gripTags" in body) {
    data.gripTags = normalizeGripTags(body.gripTags);
  }
  if (body && "layoutTags" in body) {
    data.layoutTags = normalizeLayoutTags(body.layoutTags);
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const track = await prisma.track.update({
    where: { id: trackId },
    data,
    select: { id: true, name: true, location: true, gripTags: true, layoutTags: true },
  });

  return NextResponse.json({ track });
}
