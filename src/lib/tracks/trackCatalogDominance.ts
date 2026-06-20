import "server-only";

import type { Prisma } from "@prisma/client";

/**
 * Community track catalog dominance: one row per display name (case-insensitive).
 * POST rejects duplicates; when legacy duplicates exist, the **oldest** row (first
 * creator) wins — see `dominantTrackByNameWhere`.
 */
export function normalizeTrackCatalogName(name: string): string {
  return name.trim().toLowerCase();
}

export function dominantTrackByNameWhere(name: string): Prisma.TrackWhereInput {
  const trimmed = name.trim();
  if (!trimmed) return { id: { in: [] } };
  return { name: { equals: trimmed, mode: "insensitive" } };
}

/** Prefer oldest row when resolving a name collision (legacy duplicates). */
export const DOMINANT_TRACK_ORDER_BY = [{ createdAt: "asc" as const }, { id: "asc" as const }];
