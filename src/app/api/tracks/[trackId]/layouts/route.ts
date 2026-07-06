import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { canManageCommunityTrack } from "@/lib/tracks/trackAccess";
import { revalidateAfterTrackMutation } from "@/lib/revalidateUser";

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
 * Reconcile the full layout list for a track: update existing rows (by id),
 * create rows without an id, and delete existing rows absent from the payload.
 * Updating (rather than delete+recreate) preserves the FK links from runs/events.
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

  const body = (await request.json().catch(() => null)) as { layouts?: LayoutInput[] } | null;
  if (!body || !Array.isArray(body.layouts)) {
    return NextResponse.json({ error: "layouts array is required" }, { status: 400 });
  }

  // Normalize + validate the incoming rows, preserving order for sortOrder.
  const incoming = body.layouts
    .map((row) => ({
      id: typeof row.id === "string" && row.id ? row.id : undefined,
      name: typeof row.name === "string" ? row.name.trim() : "",
      notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null,
    }))
    .filter((row) => row.name.length > 0);

  if (incoming.some((row) => row.name.length > 120)) {
    return NextResponse.json({ error: "Layout names must be 120 characters or fewer." }, { status: 400 });
  }

  const existing = await prisma.trackLayout.findMany({
    where: { trackId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((l) => l.id));
  const keptIds = new Set(incoming.map((row) => row.id).filter((id): id is string => Boolean(id)));
  const toDelete = [...existingIds].filter((id) => !keptIds.has(id));

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
