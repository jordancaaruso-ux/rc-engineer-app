import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { parseCoordinates } from "@/lib/location/coordinates";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { revalidateAfterTrackMutation } from "@/lib/revalidateUser";
import { normalizeGripTags, normalizeLayoutTags } from "@/lib/trackMetaTags";
import { validateLiveRcTrackUrl } from "@/lib/lapWatch/liveRcTrackUrl";
import { validateSpeedhiveTrackUrl } from "@/lib/speedhive/speedhiveUrl";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { canManageCatalogRow } from "@/lib/assets/catalogAccessLogic";
import { trackUsedByOthers } from "@/lib/assets/catalogUsage";
import { archiveTrackLegacyDataBeforeDelete } from "@/lib/tracks/legacyTrackSnapshot";

/**
 * Unified catalog rule for aggregation-affecting track identity (grip/layout tags) and
 * deletion: admin always; else the creator only while the track is unverified AND unused
 * by others. Low-stakes contributions (GPS, LiveRC/Speedhive URLs) stay open to any driver.
 */
async function canManageTrackIdentity(
  user: { id: string; email: string | null },
  track: { id: string; userId: string; verifiedAt: Date | null }
): Promise<boolean> {
  if (isAuthAdminEmail(user.email)) return true;
  const verified = track.verifiedAt != null;
  const isCreator = track.userId === user.id;
  if (verified || !isCreator) return false;
  const usedByOthers = await trackUsedByOthers(track.id, user.id);
  return canManageCatalogRow(user, {
    creatorUserId: track.userId,
    verified,
    usedByOthers,
  });
}

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
      speedhiveUrl: true,
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
    speedhiveUrl?: string | null;
    latitude?: unknown;
    longitude?: unknown;
    locationSource?: string | null;
    clearLocation?: boolean;
    verified?: boolean;
  } | null;

  const existing = await prisma.track.findFirst({
    where: communityTrackByIdWhere(trackId),
    select: { id: true, userId: true, verifiedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  // Grip/layout tags key the community condition buckets — protect them with the unified
  // rule. GPS + track URLs are contributions any driver may add, so they stay open.
  const touchesAggregationIdentity =
    !!body && ("gripTags" in body || "layoutTags" in body);
  if (touchesAggregationIdentity && !(await canManageTrackIdentity(user, existing))) {
    return NextResponse.json(
      {
        error:
          "This track's grip/layout tags are locked — only the creator (while unverified and unused) or an admin can change them.",
      },
      { status: 403 }
    );
  }

  const data: {
    gripTags?: string[];
    layoutTags?: string[];
    liveRcUrl?: string | null;
    speedhiveUrl?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    locationMarkedAt?: Date | null;
    locationSource?: string | null;
    verifiedAt?: Date | null;
  } = {};
  // Verification is admin-only (founder ground truth).
  if (body && typeof body.verified === "boolean" && isAuthAdminEmail(user.email)) {
    data.verifiedAt = body.verified ? new Date() : null;
  }
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
  if (body && "speedhiveUrl" in body) {
    if (
      body.speedhiveUrl == null ||
      (typeof body.speedhiveUrl === "string" && !body.speedhiveUrl.trim())
    ) {
      data.speedhiveUrl = null;
    } else if (typeof body.speedhiveUrl === "string") {
      const v = validateSpeedhiveTrackUrl(body.speedhiveUrl);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      data.speedhiveUrl = v.normalized;
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
      speedhiveUrl: true,
      gripTags: true,
      layoutTags: true,
    },
  });

  revalidateAfterTrackMutation(user.id);
  return NextResponse.json({ track });
}

export async function DELETE(
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
    select: { id: true, userId: true, verifiedAt: true },
  });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }
  if (!(await canManageTrackIdentity(user, track))) {
    return NextResponse.json(
      {
        error:
          "Only the creator (while unverified and unused) or an admin can delete this track.",
      },
      { status: 403 }
    );
  }

  await archiveTrackLegacyDataBeforeDelete(trackId);
  await prisma.track.delete({ where: { id: trackId } });
  revalidateAfterTrackMutation(user.id);
  return NextResponse.json({ ok: true });
}
