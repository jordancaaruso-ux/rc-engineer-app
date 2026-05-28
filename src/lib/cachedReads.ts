import { unstable_cache } from "next/cache";
import { loadDashboardHomeModel } from "@/lib/dashboardServer";
import { dashboardTag } from "@/lib/cacheTags";

/** Cached dashboard payload — invalidated on run/action-item mutations. */
export async function getCachedDashboardHomeModel(userId: string, timeZone: string) {
  return unstable_cache(
    async () => loadDashboardHomeModel(userId, timeZone),
    [`dashboard-home-v2-${userId}-${timeZone}`],
    { tags: [dashboardTag(userId)], revalidate: 30 }
  )();
}
