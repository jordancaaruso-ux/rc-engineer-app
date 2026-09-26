import { NextResponse, after } from "next/server";
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
import { canEditLiveRcUrl } from "@/lib/tracks/trackAccess";
import { trackUsedByOthers } from "@/lib/assets/catalogUsage";
import { archiveTrackLegacyDataBeforeDelete } from "@/lib/tracks/legacyTrackSnapshot";
import { timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";
import { fillTrackLocation } from "@/lib/tracks/trackLocationFill";

/**
 * Who may DELETE a track: an admin always; else its creator, while no other driver uses it.
 *
 * Verification no longer enters into it. Every track is trusted on arrival since 2026-09-26
 * (founder ruling), so `verifiedAt` stopped meaning "the founder looked at this" — keyed on it, the
 * rule would take a driver's own Delete away the moment they made the track, typo and all. Whether
 * anyone else depends on the row is the protection that matters, and it is the one kept.
 *
 * Editing no longer passes through here. Grip/layout tags were locked by this rule until
 * 2026-09-18 on the reasoning that they keyed community condition buckets — they no longer do
 * (aggregations read grip off each setup document's own traction tags), and the lock had made
 * the tags uneditable by ANYONE but an admin, because the catalog importer stamps every seeded
 * row verified and owns it from a system account. Founder call: the tags are global, any driver
 * may set or correct them. The single exception is a LiveRC catalog row's URL — see
 * `canEditLiveRcUrl`, which is identity rather than contribution.
 */
async function canManageTrackIdentity(
  user: { id: string; email: string | null },
  track: { id: string; userId: string }
): Promise<boolean> {
  if (isAuthAdminEmail(user.email)) return true;
  if (track.userId !== user.id) return false;
  return !(await trackUsedByOthers(track.id, user.id));
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
    select: { id: true, userId: true, verifiedAt: true, catalogSource: true, liveRcUrl: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
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
    timeZone?: string | null;
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
  // The one field that is identity rather than contribution. Compared against what is stored,
  // so re-sending a catalog row's own URL (the link finder posts both) is never refused — only
  // a real repoint is.
  if (
    "liveRcUrl" in data &&
    data.liveRcUrl !== existing.liveRcUrl &&
    !canEditLiveRcUrl(user, existing)
  ) {
    return NextResponse.json(
      {
        error:
          "This track's LiveRC address is what identifies it in the catalog and can't be changed here.",
      },
      { status: 403 }
    );
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
    data.timeZone = null;
  } else if (body && ("latitude" in body || "longitude" in body)) {
    const parsed = parseCoordinates(body.latitude, body.longitude);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    data.latitude = parsed.latitude;
    data.longitude = parsed.longitude;
    data.locationMarkedAt = new Date();
    data.timeZone = timeZoneForCoordinates(parsed.latitude, parsed.longitude);
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

  // A LiveRC link just added carries the club's address — a better pin than a typed town.
  if (data.liveRcUrl) after(() => fillTrackLocation(track.id).then(() => undefined));

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
          "Only the driver who added this track, while nobody else uses it, or an admin can delete it.",
      },
      { status: 403 }
    );
  }

  await archiveTrackLegacyDataBeforeDelete(trackId);
  await prisma.track.delete({ where: { id: trackId } });
  revalidateAfterTrackMutation(user.id);
  return NextResponse.json({ ok: true });
}
