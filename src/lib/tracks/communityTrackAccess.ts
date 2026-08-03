import type { Prisma } from "@prisma/client";

import { demoCatalogUserId, isDemoIdentity } from "@/lib/demo/demoAccess";

export type TrackCatalogViewer = { id?: string | null; email?: string | null };

/**
 * Demo rows are NOT community rows.
 *
 * `scripts/seed-demo-account.ts` clones the founder's tracks into the shared demo account —
 * same name, same location, same createdAt — so every seeded track appeared twice in the one
 * global catalog. That is where the duplicate list entries came from.
 *
 * Rule: real sessions never see demo-owned tracks; a demo session sees demo-owned tracks and
 * nothing else, so the demo stays self-contained (and real users' rows stay out of a public
 * browsing surface). Apply this to every track **list**; `communityTrackByIdWhere` stays open so
 * existing links and each side's own runs keep resolving.
 */
export function trackCatalogScopeWhere(viewer: TrackCatalogViewer): Prisma.TrackWhereInput {
  const demoUserId = demoCatalogUserId();
  const viewerIsDemo = viewer.id === demoUserId || isDemoIdentity(viewer);
  return viewerIsDemo ? { userId: demoUserId } : { userId: { not: demoUserId } };
}

export function communityTrackListWhere(
  viewer: TrackCatalogViewer,
  search?: string
): Prisma.TrackWhereInput {
  const scope = trackCatalogScopeWhere(viewer);
  const q = search?.trim();
  if (!q) return scope;
  return {
    ...scope,
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
    ],
  };
}

export function communityTrackByIdWhere(trackId: string): Prisma.TrackWhereInput {
  return { id: trackId };
}
