import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";

/**
 * The handful of true things the demo entry screen says about the season it's about to hand
 * over (`/demo`, DemoEntryScreen).
 *
 * These have to be read server-side. The entry page renders BEFORE sign-in — there is no
 * session, so the client cannot query anything — and hard-coding "7 months / 41 runs" would
 * go stale the first time the seed is re-run with a different `--months`. Every field is
 * nullable and the screen simply drops the row it can't fill, so a cold database or a
 * pre-seed deploy degrades to a shorter spec list rather than a lie or a crash.
 */
export type DemoSeasonFacts = {
  driverName: string | null;
  seasonMonths: number | null;
  runCount: number | null;
  trackCount: number | null;
};

const EMPTY: DemoSeasonFacts = {
  driverName: null,
  seasonMonths: null,
  runCount: null,
  trackCount: null,
};

const MS_PER_MONTH = 30.44 * 24 * 60 * 60 * 1000;

async function loadDemoSeasonFacts(): Promise<DemoSeasonFacts> {
  if (!hasDatabaseUrl()) return EMPTY;
  const userId = demoCatalogUserId();

  try {
    const [user, runs, tracks] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.run.aggregate({
        where: { userId },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      // groupBy over trackId rather than `distinct` — this counts venues, and a run whose
      // track row was deleted (trackId null) must not become a phantom venue.
      prisma.run.groupBy({
        by: ["trackId"],
        where: { userId, trackId: { not: null } },
      }),
    ]);

    const first = runs._min.createdAt;
    const last = runs._max.createdAt;
    const seasonMonths =
      first && last ? Math.max(1, Math.round((last.getTime() - first.getTime()) / MS_PER_MONTH)) : null;

    return {
      driverName: user?.name?.trim() || null,
      seasonMonths,
      runCount: runs._count._all > 0 ? runs._count._all : null,
      trackCount: tracks.length > 0 ? tracks.length : null,
    };
  } catch {
    // The door is not worth failing over. Fewer rows, same screen.
    return EMPTY;
  }
}

/**
 * Cached for an hour. The demo account only changes when the founder re-runs `demo:seed`, and
 * this read sits on the critical path of a first impression — it must never cost a round trip
 * that the visitor waits on twice.
 */
export async function getDemoSeasonFacts(): Promise<DemoSeasonFacts> {
  return unstable_cache(loadDemoSeasonFacts, ["demo-season-facts-v1"], { revalidate: 3600 })();
}
