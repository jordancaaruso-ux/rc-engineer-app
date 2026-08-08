import type { Prisma } from "@prisma/client";

import { demoCatalogUserId, isDemoIdentity } from "@/lib/demo/demoAccess";
import { throwawayEmailWhere } from "@/lib/account/throwawayAccounts";

export type TrackCatalogViewer = { id?: string | null; email?: string | null };

/**
 * Tracks created by a disposable `+ob…` onboarding-test account are dev debris, not community
 * rows — but the account that made them is mid-walkthrough and must still see its own work, or
 * the flow the throwaway exists to test (add a track, then pick it) breaks in a way real users
 * never experience. So: own rows always, other throwaways never.
 *
 * Returned nested under `AND` on purpose. `communityTrackListWhere` puts the search on a
 * top-level `OR`; a second top-level `OR` here would be silently overwritten by the spread.
 */
function throwawayExclusionWhere(viewer: TrackCatalogViewer): Prisma.TrackWhereInput {
  const notThrowaway: Prisma.TrackWhereInput = {
    user: { isNot: { email: throwawayEmailWhere() } },
  };
  if (!viewer.id) return notThrowaway;
  return { OR: [{ userId: viewer.id }, notThrowaway] };
}

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
  if (viewerIsDemo) return { userId: demoUserId };
  return {
    userId: { not: demoUserId },
    AND: [throwawayExclusionWhere(viewer)],
  };
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
