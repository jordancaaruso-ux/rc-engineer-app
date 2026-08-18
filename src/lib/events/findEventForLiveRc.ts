import { eventDateToYmd } from "@/lib/eventDateParse";
import { prisma } from "@/lib/prisma";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import { listTeamPeerUserIds } from "@/lib/teamAccess";

/** Find a global event by track + normalized LiveRC results hub URL. */
export async function findEventByTrackAndResultsUrl(
  trackId: string,
  resultsSourceUrl: string
): Promise<{ id: string; name: string } | null> {
  const target = normalizeLiveRcEventHubUrl(resultsSourceUrl) ?? resultsSourceUrl.trim();
  if (!target) return null;

  const rows = await prisma.event.findMany({
    where: { trackId, resultsSourceUrl: { not: null } },
    select: { id: true, name: true, resultsSourceUrl: true },
  });
  const match = rows.find((row) => {
    const norm = row.resultsSourceUrl
      ? normalizeLiveRcEventHubUrl(row.resultsSourceUrl) ?? row.resultsSourceUrl.trim()
      : null;
    return norm === target;
  });
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * Planned event at this track whose calendar range includes `referenceDate`
 * and has no LiveRC results URL yet (or already matches `eventHubUrl` when provided).
 *
 * **Scoped to the viewer's own team.** Unlike `findEventByTrackAndResultsUrl`, this match has no
 * identity claim behind it — "same track, overlapping dates" is a guess, and it used to reach
 * across every user in the database. Anyone racing at a track where a stranger had already opened
 * a planned event was folded onto that stranger's row: their event name, which only they can edit.
 * Teammates are the only people for whom the guess is worth making, so creators are now limited to
 * the viewer plus their mutual team peers. With no match the caller creates a fresh event, which is
 * exactly the right outcome for two unrelated drivers who happen to share a track.
 */
export async function findPlannedEventAtTrack(input: {
  viewerId: string;
  trackId: string;
  referenceDate: Date;
  eventHubUrl?: string | null;
}): Promise<{ id: string; name: string } | null> {
  const refYmd = eventDateToYmd(input.referenceDate);
  const normalizedHub = input.eventHubUrl
    ? normalizeLiveRcEventHubUrl(input.eventHubUrl) ?? input.eventHubUrl.trim()
    : null;

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
    },
  });

  const inRange = candidates.filter((e) => {
    const start = eventDateToYmd(e.startDate);
    const end = eventDateToYmd(e.endDate);
    if (refYmd < start || refYmd > end) return false;
    if (!e.resultsSourceUrl?.trim()) return true;
    if (!normalizedHub) return false;
    const norm =
      normalizeLiveRcEventHubUrl(e.resultsSourceUrl) ?? e.resultsSourceUrl.trim();
    return norm === normalizedHub;
  });

  if (inRange.length === 0) return null;

  inRange.sort((a, b) => {
    const aPlanned = a.resultsSourceUrl?.trim() ? 1 : 0;
    const bPlanned = b.resultsSourceUrl?.trim() ? 1 : 0;
    if (aPlanned !== bPlanned) return aPlanned - bPlanned;
    return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
  });

  return { id: inRange[0]!.id, name: inRange[0]!.name };
}
