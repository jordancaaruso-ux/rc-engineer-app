import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildSessionPageUrl,
  fetchEventSessions,
  fetchOrganizationEvents,
  fetchSessionClassification,
} from "@/lib/speedhive/speedhiveClient";
import {
  getSpeedhiveDriverNameForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import {
  normalizeSpeedhiveDriverNameForMatch,
  speedhiveDriverNameMatches,
} from "@/lib/speedhive/speedhiveNameNormalize";
import { organizationIdFromTrackUrl } from "@/lib/speedhive/speedhiveUrl";

const MAX_EVENTS = 12;
const MAX_SESSIONS_PER_EVENT = 40;

export type SpeedhiveDiscoveredSession = {
  sessionUrl: string;
  sessionId: string;
  sessionCompletedAtIso: string | null;
  sourceKind: "practice" | "race";
  label: string;
  alreadyImported: boolean;
  linkedRunId: string | null;
  timingSource: "speedhive";
};

export type DiscoverSpeedhiveSessionsResult = {
  candidates: SpeedhiveDiscoveredSession[];
  unimportedCandidates: SpeedhiveDiscoveredSession[];
  mostRecentSession: SpeedhiveDiscoveredSession | null;
  organizationId: number | null;
  hint: string | null;
};

function sessionSortKey(iso: string | null, startTime?: string | null): number {
  const raw = iso?.trim() || startTime?.trim();
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export async function discoverSpeedhiveSessionsForUser(input: {
  userId: string;
  trackSpeedhiveUrl: string;
  eventRaceClass?: string | null;
}): Promise<DiscoverSpeedhiveSessionsResult> {
  const organizationId = organizationIdFromTrackUrl(input.trackSpeedhiveUrl);
  if (!organizationId) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      organizationId: null,
      hint: "Invalid Speedhive track URL — add an organization link on the track page.",
    };
  }

  const driverName = await getSpeedhiveDriverNameForUser(input.userId);
  const driverNorm = driverName ? normalizeSpeedhiveDriverNameForMatch(driverName) : "";

  if (!driverNorm) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      organizationId,
      hint: "Set your Speedhive driver name in Settings (or LiveRC driver name) to find sessions.",
    };
  }

  const raceClassFilter = input.eventRaceClass?.trim().toLowerCase() ?? null;
  const discovered: SpeedhiveDiscoveredSession[] = [];

  try {
    const events = await fetchOrganizationEvents(organizationId, MAX_EVENTS);
    const sortedEvents = [...events].sort(
      (a, b) =>
        sessionSortKey(b.updatedAt ?? null, b.startDate ?? null) -
        sessionSortKey(a.updatedAt ?? null, a.startDate ?? null)
    );

    for (const event of sortedEvents) {
      if (!event.id) continue;
      const sessions = (await fetchEventSessions(event.id)).slice(0, MAX_SESSIONS_PER_EVENT);

      for (const sess of sessions) {
        if (!sess.id) continue;
        let classification;
        try {
          classification = await fetchSessionClassification(sess.id);
        } catch {
          continue;
        }

        const match = classification.find((row) => {
          if (!row.name?.trim()) return false;
          if (raceClassFilter && row.resultClass?.trim().toLowerCase() !== raceClassFilter) {
            return false;
          }
          return speedhiveDriverNameMatches(row.name, driverNorm);
        });

        if (!match) continue;

        const completedIso = sess.startTime
          ? new Date(sess.startTime).toISOString()
          : event.startDate
            ? new Date(`${event.startDate}T12:00:00Z`).toISOString()
            : null;

        const kind: "practice" | "race" =
          sess.type?.toLowerCase() === "practice" ? "practice" : "race";

        discovered.push({
          sessionUrl: buildSessionPageUrl(event.id, sess.id),
          sessionId: String(sess.id),
          sessionCompletedAtIso: completedIso,
          sourceKind: kind,
          label: [sess.name, match.name, event.name].filter(Boolean).join(" · "),
          alreadyImported: false,
          linkedRunId: null,
          timingSource: "speedhive",
        });
      }
    }
  } catch (e) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      organizationId,
      hint: e instanceof Error ? e.message : "Speedhive discovery failed.",
    };
  }

  const urls = discovered.map((d) => d.sessionUrl);
  const imports =
    urls.length > 0
      ? await prisma.importedLapTimeSession.findMany({
          where: { userId: input.userId, sourceUrl: { in: urls } },
          select: { sourceUrl: true, linkedRunId: true },
        })
      : [];
  const importByUrl = new Map(imports.map((i) => [i.sourceUrl, i.linkedRunId]));

  for (const d of discovered) {
    if (importByUrl.has(d.sessionUrl)) {
      d.alreadyImported = true;
      d.linkedRunId = importByUrl.get(d.sessionUrl) ?? null;
    }
  }

  const sorted = [...discovered].sort(
    (a, b) => sessionSortKey(b.sessionCompletedAtIso) - sessionSortKey(a.sessionCompletedAtIso)
  );
  const unimported = sorted.filter((d) => !d.alreadyImported);

  return {
    candidates: sorted,
    unimportedCandidates: unimported,
    mostRecentSession: unimported[0] ?? sorted[0] ?? null,
    organizationId,
    hint:
      unimported.length > 0
        ? null
        : sorted.length > 0
          ? "All matching Speedhive sessions are already imported."
          : "No Speedhive sessions matched your driver name at this organization.",
  };
}
