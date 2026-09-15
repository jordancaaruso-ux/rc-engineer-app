import "server-only";

import { discoverLiveRcSessionsForUser } from "@/lib/lapWatch/discoverLiveRcSessionsForUser";
import { fileSessionForUser, type FileSessionOutcome } from "@/lib/sweep/fileSession";
import { reportParserSuspect, reportSweepFailure } from "@/lib/observability/reportSweep";
import {
  rememberSeen,
  trackLocalYmd,
  type ArmedTrackDoc,
  type SweepPlanDoc,
  type SweepPlanTrack,
} from "@/lib/sweep/sweepDocs";
import type { PollResult } from "@/lib/sweep/pollSpeedhiveTrack";

/**
 * LiveRC has no per-track listing with names on it: the race hub is crawled page by page to find
 * a driver, with a 35 s budget. So this polls per armed driver, a few per tick, and leans on the
 * crawl's own newest-first order. Practice rows are cheap (one page, matched by name).
 */
const USERS_PER_TICK = 3;

export async function pollLiveRcTrack(params: {
  plan: Pick<SweepPlanDoc, "users">;
  track: SweepPlanTrack;
  doc: ArmedTrackDoc;
  now: Date;
  /** Evening pass: every listening user at the track, not only the armed ones. */
  userIds?: string[];
}): Promise<PollResult> {
  const result: PollResult = { byUser: new Map(), rateLimited: false, failed: false };
  const { plan, track, doc, now } = params;
  if (!track.liveRcUrl) return result;

  const todayYmd = trackLocalYmd(track.timeZone, now);
  const candidatesUsers = (params.userIds ?? Object.keys(doc.users)).filter(
    (id) => plan.users[id]?.liveRcName,
  );
  const users = params.userIds ? candidatesUsers : candidatesUsers.slice(0, USERS_PER_TICK);

  for (const userId of users) {
    let discovered: Awaited<ReturnType<typeof discoverLiveRcSessionsForUser>>;
    try {
      discovered = await discoverLiveRcSessionsForUser({
        userId,
        trackLiveRcUrl: track.liveRcUrl,
        referenceDate: now,
      });
    } catch (err) {
      reportSweepFailure(err, { stage: "poll", source: "liverc", trackId: track.id, userId });
      result.failed = true;
      continue;
    }

    // The site answered, an armed driver is there, and it lists nothing at all today: either a
    // quiet club or a page that changed under us. Say so once per day; a human can tell which.
    if (
      discovered.status?.code === "nothing_posted" &&
      doc.users[userId] &&
      doc.parserSuspectYmd !== todayYmd
    ) {
      doc.parserSuspectYmd = todayYmd;
      reportParserSuspect({
        source: "liverc",
        url: track.liveRcUrl,
        trackId: track.id,
        reason: "armed track posted nothing today",
      });
    }

    const todays = discovered.unimportedCandidates
      .filter((c) => c.sessionCompletedAtIso && c.sessionCompletedAtIso.slice(0, 10) === todayYmd)
      .sort((a, b) => (a.sessionCompletedAtIso ?? "").localeCompare(b.sessionCompletedAtIso ?? ""));

    for (const c of todays) {
      const key = `${userId}:${c.sessionUrl}`;
      if (doc.seen.includes(key)) continue;
      try {
        const outcome = await fileSessionForUser({
          userId,
          track: { id: track.id, timeZone: track.timeZone },
          sessionUrl: c.sessionUrl,
          source: "liverc",
          sourceKind: c.sourceKind,
          now,
        });
        (result.byUser.get(userId) ?? result.byUser.set(userId, []).get(userId)!).push(outcome);
        doc.seen = rememberSeen(doc.seen, key);
      } catch (err) {
        reportSweepFailure(err, { stage: "file", source: "liverc", trackId: track.id, userId, url: c.sessionUrl });
      }
    }
  }
  return result;
}
