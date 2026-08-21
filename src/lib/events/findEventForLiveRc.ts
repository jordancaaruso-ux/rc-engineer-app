import { prisma } from "@/lib/prisma";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";

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
