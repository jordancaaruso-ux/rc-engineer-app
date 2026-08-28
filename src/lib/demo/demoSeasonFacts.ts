import "server-only";
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
  } catch (error) {
    /*
     * The door is not worth failing over — fewer rows, same screen. But it IS worth saying so.
     * This catch was silent until 2026-08-25, and the cost of that silence was measured on
     * production: the live demo door was showing nothing but "Access · Read-only" — no driver,
     * no run count, no venues — while the exact same queries, run by hand against the same
     * shape of data, returned 178 runs across 6 tracks. A degraded first impression that
     * reports itself nowhere is one nobody can fix.
     */
    console.error("[demoSeasonFacts] read failed for userId=%s:", userId, error);
    return EMPTY;
  }
}

/** True when a facts read produced nothing worth showing. */
function isEmptyFacts(facts: DemoSeasonFacts): boolean {
  return !facts.driverName && !facts.runCount && !facts.trackCount;
}

/*
 * Memoised in-process for an hour, NOT in the Next data cache.
 *
 * `unstable_cache` was the wrong tool here and is the prime suspect for the production symptom
 * above: it persists across deploys, so one bad read — a deploy that landed before the seed, a
 * cold database, a connection blip — pins an empty answer onto the app's first impression and
 * keeps serving it. A plain module memo cannot outlive the lambda, and the guard below means a
 * failed or empty read is never remembered at all: the very next visitor retries.
 *
 * Ten minutes, not the hour this used to hold. Three indexed queries are not worth protecting
 * harder than that, and the shorter window was earned during testing: a re-seed renamed the demo
 * driver and the door kept introducing the previous one, which is a strange thing to be looking
 * at while checking whether a re-seed worked. The seed runs in its own process and cannot reach
 * this memo, so a short TTL is the only thing that makes a re-seed show up promptly.
 */
let memo: { facts: DemoSeasonFacts; expiresAt: number } | null = null;
const MEMO_TTL_MS = 10 * 60 * 1000;

export async function getDemoSeasonFacts(): Promise<DemoSeasonFacts> {
  if (memo && memo.expiresAt > Date.now()) return memo.facts;
  const facts = await loadDemoSeasonFacts();
  if (!isEmptyFacts(facts)) memo = { facts, expiresAt: Date.now() + MEMO_TTL_MS };
  return facts;
}
