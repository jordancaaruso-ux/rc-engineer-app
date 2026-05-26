import { unstable_cache } from "next/cache";
import { loadDashboardHomeModel } from "@/lib/dashboardServer";
import { dashboardTag } from "@/lib/cacheTags";

/** Cached dashboard payload — invalidated on run/action-item mutations. */
export async function getCachedDashboardHomeModel(userId: string) {
  return unstable_cache(
    async () => loadDashboardHomeModel(userId),
    [`dashboard-home-v1-${userId}`],
    { tags: [dashboardTag(userId)], revalidate: 30 }
  )();
}
