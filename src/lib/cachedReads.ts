import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadDashboardHomeModel } from "@/lib/dashboardServer";
import { loadAnalysisHomeModel } from "@/lib/analysis/loadAnalysisHomeModel";
import { loadPaddockModel } from "@/lib/paddock/loadPaddockModel";
import { loadToolsModel } from "@/lib/tools/loadToolsModel";
import { carsTag, dashboardTag, runsTag, tracksTag } from "@/lib/cacheTags";
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
      // v5 (2026-08-21): the summary gained `hasEverLogged` / `lastRunLabel`, which is how the
      // card tells a first-timer apart from a driver having a quiet month. A v4 entry has
      // neither, so `hasEverLogged` reads undefined and a warm user with years of history would
      // still be told to "log your first run" — exactly the bug this shipped to fix.
      [`dashboard-home-v5-${userId}-${timeZone}`],
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
      // v5: `video` swapped for `outWithYou` (2026-08-19) — a stored v4 entry has neither.
      // v6: the trend scope line and the recent-run sub-lines now name the track (2026-08-20).
      // Same shape, so a v5 entry renders fine — it just renders the OLD strings, and the first
      // thing anyone does after a copy change is reload and check. Not worth 30s of "is it broken".
      //
      // v7: `OutWithYouDriver.sharedTeamId` (2026-08-20) — the Teammates rows became doors, and a
      // v6 entry reads `undefined` there, so EVERY row silently draws as a plain readout. Found
      // the hard way: a stale v6 entry made a working link look broken for a full verification
      // pass. A new field on a cached model is a version bump, even when nothing crashes without
      // it — this one just fails silently instead of loudly.
      //
      // v8: `outWithYou` became `teammates` — `{ meeting, lastOut }` — when the card grew its
      // Last-out band (2026-08-20). A v7 entry has no `teammates` key at all, so the page would
      // drop the whole card, including the half that was working before.
      [`analysis-home-v8-${userId}-${timeZone}`],
      { tags: [runsTag(userId), dashboardTag(userId)], revalidate: 30 }
    )()
  );
}

/**
 * Cached Paddock payload — the dock cell that replaced `More`, so it is hit constantly.
 *
 * It reads from four places at once (the season model, cars, setups, tracks), which is
 * exactly the shape that makes a hub the slowest tab in the app. Same pattern as the
 * dashboard and Analysis: one cached model, busted by every mutation that can change what
 * it shows — runs, cars, tracks, and (new for this page) events.
 *
 * Event mutations revalidated NOTHING before this page existed, which was fine while
 * `/events` was `force-dynamic`. Booking a meeting and still reading "No meeting planned"
 * for half a minute is the failure that added `revalidateAfterEventMutation`.
 *
 * BUMP THE VERSION whenever the model's SHAPE changes: an entry written by the previous
 * build still deserialises, so a new field arrives `undefined` and the card renders its
 * own empty state, which reads as a data bug rather than a cache one.
 */
export async function getCachedPaddockModel(
  viewer: { id: string; email?: string | null },
  timeZone: string
) {
  return perfSpan("cachedPaddock", () =>
    unstable_cache(
      async () => loadPaddockModel({ viewer, timeZone }),
      // v6: the plain-lists pass (2026-08-19) cut every asset shape down to a name — a stored v5
      // entry still holds the counts, dates and nested setups, and the new cards would render
      // three rows where five now belong. The key HAS to move on a shape change: the tags below
      // only fire on a mutation, so an untouched account would sit on the old model for 30s and,
      // on a warm build, look like the change never deployed.
      [`paddock-v6-${viewer.id}-${timeZone}`],
      {
        // `dashboardTag` is what event mutations bust (`revalidateAfterEventMutation`), which
        // matters more here than on any other cached model: this page's hero IS the next meeting.
        tags: [
          runsTag(viewer.id),
          carsTag(viewer.id),
          tracksTag(viewer.id),
          dashboardTag(viewer.id),
        ],
        revalidate: 30,
      }
    )()
  );
}

/**
 * Cached Tools payload — the fifth dock cell (2026-08-19), so it is hit as often as Paddock.
 *
 * Wider than a hub read by design: it scans recent runs WITH their setup snapshots, and a
 * sheet is getting on for 300 boxes, so the uncached cost is real. That is the price of the
 * page not being a list of doors — every band is seeded from rows rather than from constants —
 * and it is exactly the shape `unstable_cache` exists for.
 *
 * `carsTag` is in the list even though nothing here reads the cars list directly: the geometry
 * band resolves its pack from `Car.setupSheetTemplate`, so changing a car's chassis type turns
 * a readout into a "no geometry model yet" line, or back again.
 *
 * BUMP THE VERSION whenever the model's SHAPE changes: an entry written by the previous build
 * still deserialises, so a new field arrives `undefined` and the band renders its own empty
 * state, which reads as a data bug rather than a cache one.
 */
export async function getCachedToolsModel(userId: string, timeZone: string) {
  return perfSpan("cachedTools", () =>
    unstable_cache(
      async () => loadToolsModel({ userId, timeZone }),
      // v2: the geometry band carries the solved front axle + its chassis plate for the drawing.
      // An entry from v1 would hand the schematic `undefined` and take the page down with it.
      [`tools-v2-${userId}-${timeZone}`],
      {
        tags: [runsTag(userId), carsTag(userId), dashboardTag(userId)],
        revalidate: 30,
      }
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
 *
 * NO `Date` SURVIVES THIS FUNCTION. unstable_cache round-trips its value through JSON, so a
 * `Date` field comes back a `Date` on a miss and an ISO *string* on a hit, with the type still
 * claiming `Date` — which blows up the first time anything calls `.getTime()` on it. `Car.createdAt`
 * is therefore converted to epoch ms (`createdAtMs`) inside the cached function, before the value
 * is ever stored.
 *
 * v2 (2026-08-15): gained `createdAtMs`, so /cars can order by most recent use. A v1 entry has no
 * such field, which would sort every car as if it were created at the epoch — hence the bump.
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
          prisma.car
            .findMany({
              where: { userId },
              // Only the tie-break: the page re-sorts by most recent use, which this cache
              // cannot see (a new run doesn't dirty carsTag).
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                name: true,
                chassis: true,
                notes: true,
                createdAt: true,
                setupSheetTemplate: true,
                setupSheetModelId: true,
                setupSheetModel: { select: { id: true, name: true } },
              },
            })
            .then((rows) =>
              rows.map(({ createdAt, ...car }) => ({ ...car, createdAtMs: createdAt.getTime() }))
            ),
        ]),
      [`car-manager-v2-${userId}`],
      { tags: [carsTag(userId)], revalidate: 30 }
    )()
  );
}
