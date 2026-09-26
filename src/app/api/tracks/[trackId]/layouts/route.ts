import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { canManageCommunityTrack } from "@/lib/tracks/trackAccess";
import { revalidateAfterTrackMutation } from "@/lib/revalidateUser";
import { objectionableTextError } from "@/lib/moderation/wordFilter";
import {
  findLayoutByName,
  LAYOUT_NAME_MAX,
  layoutIdsToDelete,
  normalizeLayoutName,
} from "@/lib/tracks/trackLayouts";

const LAYOUT_SELECT = {
  id: true,
  name: true,
  notes: true,
  sortOrder: true,
} as const;

type LayoutInput = {
  id?: string;
  name?: unknown;
  notes?: unknown;
};

export async function GET(
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
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const layouts = await prisma.trackLayout.findMany({
    where: { trackId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: LAYOUT_SELECT,
  });
  return NextResponse.json({ layouts });
}

/**
 * Add ONE layout to a track, from Log run. Open to any signed-in driver (founder ruling 2026-09-26:
 * a layout is a contribution, like the grip and layout tags), while PUT below (rename, reorder,
 * remove) stays with whoever added the track and admins. A name the track already has hands that
 * layout back instead of making a copy.
 */
export async function POST(
  request: Request,
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
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? normalizeLayoutName(body.name) : "";
  if (!name) return NextResponse.json({ error: "Give the layout a name." }, { status: 400 });
  if (name.length > LAYOUT_NAME_MAX) {
    return NextResponse.json({ error: "Layout names must be 120 characters or fewer." }, { status: 400 });
  }
  // Everyone racing at this track sees it in their list straight away.
  const unclean = objectionableTextError(name);
  if (unclean) return NextResponse.json({ error: unclean }, { status: 400 });

  const existing = await prisma.trackLayout.findMany({
    where: { trackId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: LAYOUT_SELECT,
  });
  const same = findLayoutByName(existing, name);
  if (same) return NextResponse.json({ layout: same, created: false });

  const layout = await prisma.trackLayout.create({
    data: {
      trackId,
      userId: user.id,
      name,
      // Last in the list: the track's own order is the creator's, and a new name joins the end.
      sortOrder: existing.reduce((max, l) => Math.max(max, l.sortOrder), -1) + 1,
    },
    select: LAYOUT_SELECT,
  });
  revalidateAfterTrackMutation(user.id);
  return NextResponse.json({ layout, created: true }, { status: 201 });
}

/**
 * Reconcile the full layout list for a track: update existing rows (by id),
 * create rows without an id, and delete existing rows absent from the payload.
 * Updating (rather than delete+recreate) preserves the FK links from runs/events.
 *
 * Only rows the page loaded (`knownIds`) can be deleted: since any driver can add a layout from
 * Log run, one may arrive while the track page is open, and saving that page must not drop it.
 */
export async function PUT(
  request: Request,
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
    select: { id: true, userId: true },
  });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  if (!canManageCommunityTrack(user, track)) {
    return NextResponse.json(
      { error: "Only the user who added this track or an admin can manage its layouts." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    layouts?: LayoutInput[];
    knownIds?: unknown;
  } | null;
  if (!body || !Array.isArray(body.layouts)) {
    return NextResponse.json({ error: "layouts array is required" }, { status: 400 });
  }
  const knownIds = Array.isArray(body.knownIds)
    ? new Set(body.knownIds.filter((id): id is string => typeof id === "string"))
    : null;

  // Normalize + validate the incoming rows, preserving order for sortOrder.
  const incoming = body.layouts
    .map((row) => ({
      id: typeof row.id === "string" && row.id ? row.id : undefined,
      name: typeof row.name === "string" ? normalizeLayoutName(row.name) : "",
      notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null,
    }))
    .filter((row) => row.name.length > 0);

  if (incoming.some((row) => row.name.length > LAYOUT_NAME_MAX)) {
    return NextResponse.json({ error: "Layout names must be 120 characters or fewer." }, { status: 400 });
  }
  const unclean = objectionableTextError(...incoming.flatMap((row) => [row.name, row.notes]));
  if (unclean) return NextResponse.json({ error: unclean }, { status: 400 });

  const existing = await prisma.trackLayout.findMany({
    where: { trackId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((l) => l.id));
  const keptIds = new Set(incoming.map((row) => row.id).filter((id): id is string => Boolean(id)));
  const toDelete = layoutIdsToDelete([...existingIds], keptIds, knownIds);

  await prisma.$transaction([
    ...toDelete.map((id) => prisma.trackLayout.delete({ where: { id } })),
    ...incoming.map((row, index) =>
      row.id && existingIds.has(row.id)
        ? prisma.trackLayout.update({
            where: { id: row.id },
            data: { name: row.name, notes: row.notes, sortOrder: index },
          })
        : prisma.trackLayout.create({
            data: {
              trackId,
              userId: user.id,
              name: row.name,
              notes: row.notes,
              sortOrder: index,
            },
          })
    ),
  ]);

  const layouts = await prisma.trackLayout.findMany({
    where: { trackId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: LAYOUT_SELECT,
  });
  revalidateAfterTrackMutation(user.id);
  return NextResponse.json({ layouts });
}
