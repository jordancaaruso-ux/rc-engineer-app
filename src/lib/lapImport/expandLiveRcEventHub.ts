import "server-only";

import { prisma } from "@/lib/prisma";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  extractRaceSessions,
  raceListRowMatchesAnyConfiguredClass,
} from "@/lib/lapWatch/livercSessionIndexParsers";

export type ExpandLiveRcEventHubForImportResult = {
  urlsToImport: string[];
  fetchFailed: boolean;
};

/**
 * Resolve a LiveRC event hub page to `view_race_result` URLs not yet stored for this user.
 * When `eventId` is set and the event has a `raceClass`, only rows matching any listed class are included.
 */
export async function expandLiveRcEventHubForImport(
  userId: string,
  hubUrl: string,
  eventId?: string | null
): Promise<ExpandLiveRcEventHubForImportResult> {
  const fetched = await fetchUrlText(hubUrl);
  if (!fetched.ok) {
    return { urlsToImport: [], fetchFailed: true };
  }

  let rows = extractRaceSessions(fetched.text, hubUrl);

  const eid = typeof eventId === "string" ? eventId.trim() : "";
  if (eid) {
    const ev = await prisma.event.findFirst({
      where: { userId, id: eid },
      select: { raceClass: true },
    });
    if (ev?.raceClass?.trim()) {
      rows = rows.filter((r) => raceListRowMatchesAnyConfiguredClass(r, ev.raceClass!.trim()));
    }
  }

  const urls = [...new Set(rows.map((r) => r.sessionUrl.trim()).filter(Boolean))];
  if (urls.length === 0) {
    return { urlsToImport: [], fetchFailed: false };
  }

  const existing = await prisma.importedLapTimeSession.findMany({
    where: { userId, sourceUrl: { in: urls } },
    select: { sourceUrl: true },
  });
  const have = new Set(existing.map((e) => e.sourceUrl.trim()));
  const urlsToImport = urls.filter((u) => !have.has(u));

  return { urlsToImport, fetchFailed: false };
}
