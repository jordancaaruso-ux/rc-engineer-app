import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildSessionPageUrl,
  fetchEventSessions,
  fetchOrganizationEvents,
  fetchSessionClassification,
  parseSpeedhiveLapTimeSeconds,
} from "@/lib/speedhive/speedhiveClient";
import {
  classificationRowMatchesUser,
  sessionClassificationHasTransponderFields,
} from "@/lib/speedhive/speedhiveClassificationMatch";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { normalizeSpeedhiveDriverNamesForMatch } from "@/lib/speedhive/speedhiveDriverNames";
import { discoverSpeedhivePracticeSessionsForUser } from "@/lib/speedhive/discoverSpeedhivePracticeSessionsForUser";
import { practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import { organizationIdFromTrackUrl } from "@/lib/speedhive/speedhiveUrl";

const MAX_EVENTS = 12;
const MAX_SESSIONS_PER_EVENT = 40;

export type SpeedhiveDiscoveredSession = {
  sessionUrl: string;
  sessionId: string;
  sessionCompletedAtIso: string | null;
  sourceKind: "practice" | "race";
  label: string;
  /** Fastest lap in seconds, when known at discovery time. */
  bestLapSeconds?: number | null;
  alreadyImported: boolean;
  linkedRunId: string | null;
  timingSource: "speedhive";
};

export type DiscoverSpeedhiveSessionsResult = {
  candidates: SpeedhiveDiscoveredSession[];
  unimportedCandidates: SpeedhiveDiscoveredSession[];
  mostRecentSession: SpeedhiveDiscoveredSession | null;
  organizationId: number | null;
  practiceLocationId: number | null;
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
  const practiceLocationId = practiceLocationIdFromTrackUrl(input.trackSpeedhiveUrl);
  if (practiceLocationId) {
    const practice = await discoverSpeedhivePracticeSessionsForUser({
      userId: input.userId,
      trackSpeedhiveUrl: input.trackSpeedhiveUrl,
    });
    return {
      candidates: practice.candidates,
      unimportedCandidates: practice.unimportedCandidates,
      mostRecentSession: practice.mostRecentSession,
      organizationId: null,
      practiceLocationId: practice.practiceLocationId,
      hint: practice.hint,
    };
  }

  return discoverSpeedhiveOrganizationSessionsForUser(input);
}

async function discoverSpeedhiveOrganizationSessionsForUser(input: {
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
      practiceLocationId: null,
      hint:
        "Invalid Speedhive track URL — use a practice link (…/practice/4591) or an organization page (…/organizations/123).",
    };
  }

  const [driverNames, userTransponders] = await Promise.all([
    getSpeedhiveDriverNamesForUser(input.userId),
    getSpeedhiveTransponderNumbersForUser(input.userId),
  ]);
  const driverNorms = normalizeSpeedhiveDriverNamesForMatch(driverNames);

  if (driverNorms.length === 0 && userTransponders.length === 0) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      organizationId,
      practiceLocationId: null,
      hint:
        "Set your MYLAPS transponder number or your name on MYLAPS in Settings to find sessions at this track.",
    };
  }

  const raceClassFilter = input.eventRaceClass?.trim().toLowerCase() ?? null;
  const discovered: SpeedhiveDiscoveredSession[] = [];
  let sawTransponderFields = false;

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

        if (!sawTransponderFields && sessionClassificationHasTransponderFields(classification)) {
          sawTransponderFields = true;
        }

        const match = classification.find((row) =>
          classificationRowMatchesUser({
            row,
            userTransponders,
            driverNorms,
            raceClassFilter,
          })
        );

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
          bestLapSeconds: match.bestTime
            ? parseSpeedhiveLapTimeSeconds(match.bestTime)
            : null,
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
      practiceLocationId: null,
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

  const hasNames = driverNorms.length > 0;
  const noMatchHint =
    userTransponders.length > 0 && !sawTransponderFields && !hasNames
      ? "No Speedhive sessions matched your transponder at this organization. Public results here may not include transponder numbers — add the names you appear under in Settings as a fallback."
      : userTransponders.length > 0 && !sawTransponderFields && hasNames
        ? "No sessions matched at this organization. Public results may not list transponder numbers; matching used your driver names where possible."
        : "No Speedhive sessions matched your transponders or driver names at this organization.";

  return {
    candidates: sorted,
    unimportedCandidates: unimported,
    mostRecentSession: unimported[0] ?? sorted[0] ?? null,
    organizationId,
    practiceLocationId: null,
    hint:
      unimported.length > 0
        ? null
        : sorted.length > 0
          ? "All matching Speedhive sessions are already imported."
          : noMatchHint,
  };
}
