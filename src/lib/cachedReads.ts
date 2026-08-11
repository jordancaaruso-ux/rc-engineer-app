import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadDashboardHomeModel } from "@/lib/dashboardServer";
import { loadAnalysisHomeModel } from "@/lib/analysis/loadAnalysisHomeModel";
import { carsTag, dashboardTag, runsTag } from "@/lib/cacheTags";
import { perfSpan } from "@/lib/perfLog";

/*
 * Each cached read is wrapped in a `perfSpan`. Queries inside `unstable_cache` run in a
 * detached context the request-scoped perf store cannot see, and a cache *hit* runs no
 * queries at all — so without these spans `/` and `/analysis` would look free and get
 * mis-ranked. The phase duration makes the hit/miss split obvious: ~1ms is a hit.
 */

/** Cached dashboard payload — invalidated on run/action-item mutations. */
export async function getCachedDashboardHomeModel(userId: string, timeZone: string) {
  return perfSpan("cachedDashboardHome", () =>
    unstable_cache(
      async () => loadDashboardHomeModel(userId, timeZone),
      // v3 (2026-08-08): `heroPace` added for the desktop hero. Bump this whenever the
      // model GAINS a field — a cached v2 entry has no `heroPace`, so the hero silently
      // renders nothing until the 30s window rolls, which on a deploy means every warm
      // user sees a broken page for half a minute.
      // v4 (2026-08-10): `heroPace` gained `seriesKind` / `trackName` / `anchorLabel` and
      // `consistency.percent`. A v3 entry is worse than missing here — it still holds the
      // OLD mixed-track series, so a warm user would keep seeing three tracks on one line
      // with the new single-track labels wrapped around it.
      [`dashboard-home-v4-${userId}-${timeZone}`],
      { tags: [dashboardTag(userId)], revalidate: 30 }
    )()
  );
}

/**
 * Cached Analysis debrief payload — mirrors the dashboard pattern so the Tier-A
 * `/analysis` screen stops re-running its trend + recent + video queries on
 * every navigation. Invalidated on run mutations (revalidateAfterRunMutation
 * busts runsTag) and also via the dashboard tag; a 30s window covers video-job
 * status drift, which isn't tag-invalidated.
 *
 * BUMP THE VERSION whenever the model's SHAPE changes. Tags and `revalidate`
 * only handle staleness of the *data*; an entry written by the previous build
 * still deserialises, so a new field arrives `undefined` and the UI renders its
 * own empty state — which looks like a data problem, not a cache one. v2 added
 * `AnalysisTrendRun.distribution` for the trend chart's spread view; v3 added
 * `totalRunCount` for the Recent-runs card's door into Sessions (a v2 entry
 * would render that door with no number on it); v4 added `hasTeam`, which gates
 * that door's mention of team sessions (a v3 entry reads `undefined` and quietly
 * hides the mention from every team member until the window rolls).
 */
export async function getCachedAnalysisHomeModel(userId: string, timeZone: string) {
  return perfSpan("cachedAnalysisHome", () =>
    unstable_cache(
      async () => loadAnalysisHomeModel(userId, timeZone),
      [`analysis-home-v4-${userId}-${timeZone}`],
      { tags: [runsTag(userId), dashboardTag(userId)], revalidate: 30 }
    )()
  );
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
  return perfSpan("cachedCarManager", () =>
    unstable_cache(
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
    )()
  );
}
