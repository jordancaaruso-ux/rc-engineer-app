import type { Prisma } from "@prisma/client";

export function communityTrackListWhere(search?: string): Prisma.TrackWhereInput {
  const q = search?.trim();
  if (!q) return {};
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
    ],
  };
}

export function communityTrackByIdWhere(trackId: string): Prisma.TrackWhereInput {
  return { id: trackId };
}
