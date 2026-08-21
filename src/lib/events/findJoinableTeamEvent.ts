import { prisma } from "@/lib/prisma";
import { listTeamPeerUserIds } from "@/lib/teamAccess";
import {
  rankJoinableTeamEvents,
  type JoinableEventMatch,
  JOINABLE_EVENT_WINDOW_DAYS,
} from "@/lib/events/joinableTeamEventLogic";

export { JOINABLE_EVENT_WINDOW_DAYS } from "@/lib/events/joinableTeamEventLogic";

type JoinableEventRow = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  resultsSourceUrl: string | null;
  userId: string | null;
};

/**
 * My team's events at this track that I could be here for, best first.
 *
 * **Scoped to the viewer plus their mutual team peers.** "Same track, same week" is a guess with no
 * identity claim behind it, and it used to reach across every user in the database: anyone racing at
 * a track where a stranger had opened an event was folded onto that stranger's row, under a name
 * only they could edit. Teammates are the only people for whom the guess is worth making. With no
 * match the caller creates a fresh event, which is the right outcome for two unrelated drivers who
 * happen to share a track.
 *
 * Replaced `findPlannedEventAtTrack`, which was reachable only after LiveRC confirmed a meeting was
 * running — so a teammate's event at a track LiveRC has never heard of could not be found at all.
 */
export async function listJoinableTeamEventsAtTrack(input: {
  viewerId: string;
  trackId: string;
  referenceDate: Date;
  eventHubUrl?: string | null;
  windowDays?: number;
}): Promise<Array<JoinableEventMatch<JoinableEventRow>>> {
  const allowedCreatorIds = [
    input.viewerId,
    ...(await listTeamPeerUserIds(input.viewerId)),
  ];

  const candidates = await prisma.event.findMany({
    where: { trackId: input.trackId, userId: { in: allowedCreatorIds } },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      resultsSourceUrl: true,
      userId: true,
    },
  });

  return rankJoinableTeamEvents({
    candidates,
    referenceDate: input.referenceDate,
    eventHubUrl: input.eventHubUrl,
    windowDays: input.windowDays ?? JOINABLE_EVENT_WINDOW_DAYS,
  });
}

/** The single best event to offer, or null. */
export async function findJoinableTeamEventAtTrack(input: {
  viewerId: string;
  trackId: string;
  referenceDate: Date;
  eventHubUrl?: string | null;
  windowDays?: number;
}): Promise<JoinableEventMatch<JoinableEventRow> | null> {
  const matches = await listJoinableTeamEventsAtTrack(input);
  return matches[0] ?? null;
}
