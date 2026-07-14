import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadDashboardHomeModel } from "@/lib/dashboardServer";
import { loadAnalysisHomeModel } from "@/lib/analysis/loadAnalysisHomeModel";
import { carsTag, dashboardTag, runsTag } from "@/lib/cacheTags";

/** Cached dashboard payload — invalidated on run/action-item mutations. */
export async function getCachedDashboardHomeModel(userId: string, timeZone: string) {
  return unstable_cache(
    async () => loadDashboardHomeModel(userId, timeZone),
    [`dashboard-home-v2-${userId}-${timeZone}`],
    { tags: [dashboardTag(userId)], revalidate: 30 }
  )();
}

/**
 * Cached Analysis debrief payload — mirrors the dashboard pattern so the Tier-A
 * `/analysis` screen stops re-running its trend + recent + video queries on
 * every navigation. Invalidated on run mutations (revalidateAfterRunMutation
 * busts runsTag) and also via the dashboard tag; a 30s window covers video-job
 * status drift, which isn't tag-invalidated.
 */
export async function getCachedAnalysisHomeModel(userId: string, timeZone: string) {
  return unstable_cache(
    async () => loadAnalysisHomeModel(userId, timeZone),
    [`analysis-home-v1-${userId}-${timeZone}`],
    { tags: [runsTag(userId), dashboardTag(userId)], revalidate: 30 }
  )();
}

/**
 * Cached Car Manager reads (global setup-sheet models + the user's cars) so the
 * first tap into /cars from a cold client cache skips two DB round trips.
 * Invalidated via carsTag on create (POST /api/cars) and edit/delete
 * (PATCH/DELETE /api/cars/[carId]); the 30s window covers rare admin model-catalog
 * changes, which aren't carsTag-invalidated. The catalog seed
 * (ensureAuthorizedSetupSheetCatalog) stays OUTSIDE this cache — it must run each load.
 * No Date fields are selected, so unstable_cache's JSON round trip is lossless here.
 */
export async function getCachedCarManagerData(userId: string) {
  return unstable_cache(
    async () =>
      Promise.all([
        prisma.setupSheetModel.findMany({
          orderBy: [{ isAuthorized: "desc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            slug: true,
            isAuthorized: true,
            _count: { select: { cars: true, calibrations: true } },
          },
        }),
        prisma.car.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            chassis: true,
            notes: true,
            setupSheetTemplate: true,
            setupSheetModelId: true,
            setupSheetModel: { select: { id: true, name: true } },
          },
        }),
      ]),
    [`car-manager-v1-${userId}`],
    { tags: [carsTag(userId)], revalidate: 30 }
  )();
}
