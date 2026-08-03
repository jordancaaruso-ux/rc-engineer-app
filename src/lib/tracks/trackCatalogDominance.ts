import "server-only";

import type { Prisma } from "@prisma/client";

import { trackCatalogScopeWhere, type TrackCatalogViewer } from "./communityTrackAccess";

/**
 * Community track catalog dominance: one row per display name (case-insensitive).
 * POST rejects duplicates; when legacy duplicates exist, the **oldest** row (first
 * creator) wins — see `dominantTrackByNameWhere`.
 */
export function normalizeTrackCatalogName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Scoped to the viewer's catalog: a demo clone copies the original's `createdAt` verbatim, so
 * without the scope the oldest-wins tiebreak could hand a real creator the demo row.
 */
export function dominantTrackByNameWhere(
  name: string,
  viewer: TrackCatalogViewer
): Prisma.TrackWhereInput {
  const trimmed = name.trim();
  if (!trimmed) return { id: { in: [] } };
  return { ...trackCatalogScopeWhere(viewer), name: { equals: trimmed, mode: "insensitive" } };
}

/** Prefer oldest row when resolving a name collision (legacy duplicates). */
export const DOMINANT_TRACK_ORDER_BY = [{ createdAt: "asc" as const }, { id: "asc" as const }];
