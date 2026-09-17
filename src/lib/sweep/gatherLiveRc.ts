import "server-only";

import { discoverLiveRcSessionsForUser } from "@/lib/lapWatch/discoverLiveRcSessionsForUser";
import type { FetchTextResult } from "@/lib/lapUrlParsers/fetchText";
import { emptyGather, pushCandidate, type GatherResult } from "@/lib/sweep/gatherSpeedhivePractice";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import type { SweepPlanDoc, SweepPlanTrack } from "@/lib/sweep/sweepDocs";

/**
 * One day's LiveRC sessions at one track, per listening driver. LiveRC has no per-track listing
 * with names on it: the race hub is crawled page by page to find a driver, with a 35 s budget.
 * The pages are the same whoever is being looked for, so one track look fetches each page once
 * and every driver after the first is matched from memory. Nothing is filed here.
 */
export async function gatherLiveRc(params: {
  plan: Pick<SweepPlanDoc, "users">;
  track: SweepPlanTrack;
  /** The track-local day being gathered — today at 8 pm, yesterday at 8 am. */
  ymd: string;
  now: Date;
  userIds: readonly string[];
}): Promise<GatherResult> {
  const result = emptyGather();
  const { plan, track, now } = params;
  if (!track.liveRcUrl) return result;

  const todayYmd = params.ymd;
  const users = params.userIds.filter((id) => plan.users[id]?.liveRcName);
  // The hub and every race page are the same for every driver: fetched once, read per driver.
  const pageCache = new Map<string, FetchTextResult>();

  for (const userId of users) {
    let discovered: Awaited<ReturnType<typeof discoverLiveRcSessionsForUser>>;
    try {
      discovered = await discoverLiveRcSessionsForUser({
        userId,
        trackLiveRcUrl: track.liveRcUrl,
        referenceDate: now,
        practiceDayYmd: todayYmd,
        pageCache,
      });
    } catch (err) {
      reportSweepFailure(err, { stage: "poll", source: "liverc", trackId: track.id, userId });
      result.failed = true;
      continue;
    }

    const todays = discovered.unimportedCandidates
      .filter((c) => c.sessionCompletedAtIso && c.sessionCompletedAtIso.slice(0, 10) === todayYmd)
      .sort((a, b) => (a.sessionCompletedAtIso ?? "").localeCompare(b.sessionCompletedAtIso ?? ""));

    for (const c of todays) {
      pushCandidate(result, userId, {
        sessionUrl: c.sessionUrl,
        source: "liverc",
        sourceKind: c.sourceKind,
        listedAtIso: c.sessionCompletedAtIso,
      });
    }
  }
  return result;
}
