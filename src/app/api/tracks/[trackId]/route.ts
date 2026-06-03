import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { parseCoordinates } from "@/lib/location/coordinates";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { revalidateAfterTrackMutation } from "@/lib/revalidateUser";
import { normalizeGripTags, normalizeLayoutTags } from "@/lib/trackMetaTags";
import { validateLiveRcTrackUrl } from "@/lib/lapWatch/liveRcTrackUrl";

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
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const track = await prisma.track.findFirst({
    where: communityTrackByIdWhere(trackId),
    select: {
      id: true,
      name: true,
      location: true,
      latitude: true,
      longitude: true,
      locationMarkedAt: true,
      locationSource: true,
      liveRcUrl: true,
      gripTags: true,
      layoutTags: true,
      createdAt: true,
    },
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
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    gripTags?: unknown;
    layoutTags?: unknown;
    liveRcUrl?: string | null;
    latitude?: unknown;
    longitude?: unknown;
    locationSource?: string | null;
    clearLocation?: boolean;
  } | null;

  const existing = await prisma.track.findFirst({
    where: communityTrackByIdWhere(trackId),
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const data: {
    gripTags?: string[];
    layoutTags?: string[];
    liveRcUrl?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    locationMarkedAt?: Date | null;
    locationSource?: string | null;
  } = {};
  if (body && "gripTags" in body) {
    data.gripTags = normalizeGripTags(body.gripTags);
  }
  if (body && "layoutTags" in body) {
    data.layoutTags = normalizeLayoutTags(body.layoutTags);
  }
  if (body && "liveRcUrl" in body) {
    if (body.liveRcUrl == null || (typeof body.liveRcUrl === "string" && !body.liveRcUrl.trim())) {
      data.liveRcUrl = null;
    } else if (typeof body.liveRcUrl === "string") {
      const v = validateLiveRcTrackUrl(body.liveRcUrl);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      data.liveRcUrl = v.normalized;
    }
  }
  if (body?.clearLocation === true) {
    data.latitude = null;
    data.longitude = null;
    data.locationMarkedAt = null;
    data.locationSource = null;
  } else if (body && ("latitude" in body || "longitude" in body)) {
    const parsed = parseCoordinates(body.latitude, body.longitude);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    data.latitude = parsed.latitude;
    data.longitude = parsed.longitude;
    data.locationMarkedAt = new Date();
    const src = typeof body.locationSource === "string" ? body.locationSource.trim() : "";
    data.locationSource = src === "manual_paste" || src === "device" ? src : "device";
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const track = await prisma.track.update({
    where: { id: trackId },
    data,
    select: {
      id: true,
      name: true,
      location: true,
      latitude: true,
      longitude: true,
      locationMarkedAt: true,
      locationSource: true,
      liveRcUrl: true,
      gripTags: true,
      layoutTags: true,
    },
  });

  revalidateAfterTrackMutation(user.id);
  return NextResponse.json({ track });
}
