import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildSessionPageUrl,
  fetchEventSessions,
  fetchOrganizationEvents,
  fetchOrganizationEventsSince,
  fetchSessionClassification,
  parseSpeedhiveLapTimeSeconds,
  type SpeedhiveEventRow,
} from "@/lib/speedhive/speedhiveClient";
import {
  SPEEDHIVE_EVENT_LOOKBACK_DAYS,
  speedhiveSessionLocalYmd,
  speedhiveSessionWallClockIso,
  ymdShift,
} from "@/lib/speedhive/speedhiveSessionTime";
import {
  classificationRowMatchesUser,
  sessionClassificationHasTransponderFields,
} from "@/lib/speedhive/speedhiveClassificationMatch";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { normalizeSpeedhiveDriverNamesForMatch } from "@/lib/speedhive/speedhiveDriverNames";
import { userChipOnClassificationRow } from "@/lib/speedhive/speedhiveTransponder";
import { discoverSpeedhivePracticeSessionsForUser } from "@/lib/speedhive/discoverSpeedhivePracticeSessionsForUser";
import { practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import {
  emptyLapDiscoveryStatus,
  lapDiscoveryStatusMessage,
  type LapDiscoveryStatus,
} from "@/lib/lapWatch/lapDiscoveryStatus";
import { organizationIdFromTrackUrl } from "@/lib/speedhive/speedhiveUrl";

const MAX_EVENTS = 12;
const MAX_SESSIONS_PER_EVENT = 40;

export type SpeedhiveDiscoveredSession = {
  sessionUrl: string;
  /** The driver's own chip the session was found by — practice always, race when results list chips. */
  chipCode?: string | null;
  sessionId: string;
  /**
   * A race: the track's clock as-if-UTC, the way its imported result keeps it. A practice run: the
   * loop's real instant, with the track's offset in `sessionUtcOffsetMinutes`.
   */
  sessionCompletedAtIso: string | null;
  /** Practice runs: the track's offset from UTC when the run started (+02:00 → 120). */
  sessionUtcOffsetMinutes?: number | null;
  sourceKind: "practice" | "race";
  label: string;
  /** Fastest lap in seconds, when known at discovery time. */
  bestLapSeconds?: number | null;
  /** Timed laps in the session, when the discovery page carries them (practice runs do). */
  lapCount?: number | null;
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
  status: LapDiscoveryStatus | null;
  /** A named day could not be read in full; what was found is real, the list may be short. */
  incomplete?: boolean;
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
  /** "Import your last runs": practice discovery reads this whole window instead of the ten newest runs. */
  day?: { start: Date; end: Date } | null;
  /**
   * The same day as the track's date, and the track's zone — race results are read by date: every
   * meeting that could hold the day, every session in it, and wall-clock times read at the track.
   */
  dayYmd?: string | null;
  timeZone?: string | null;
}): Promise<DiscoverSpeedhiveSessionsResult> {
  const practiceLocationId = practiceLocationIdFromTrackUrl(input.trackSpeedhiveUrl);
  if (practiceLocationId) {
    const practice = await discoverSpeedhivePracticeSessionsForUser({
      userId: input.userId,
      trackSpeedhiveUrl: input.trackSpeedhiveUrl,
      day: input.day ?? null,
    });
    return {
      candidates: practice.candidates,
      unimportedCandidates: practice.unimportedCandidates,
      mostRecentSession: practice.mostRecentSession,
      organizationId: null,
      practiceLocationId: practice.practiceLocationId,
      hint: practice.hint,
      status: practice.status,
      incomplete: practice.incomplete ?? false,
    };
  }

  return discoverSpeedhiveOrganizationSessionsForUser(input);
}

/** The events a named day reads — every one that could hold it — and whether the walk finished. */
async function eventsForDiscovery(
  organizationId: number,
  dayYmd: string | null,
): Promise<{ events: SpeedhiveEventRow[]; complete: boolean }> {
  if (!dayYmd) {
    const events = await fetchOrganizationEvents(organizationId, MAX_EVENTS);
    const sorted = [...events].sort(
      (a, b) =>
        sessionSortKey(b.updatedAt ?? null, b.startDate ?? null) -
        sessionSortKey(a.updatedAt ?? null, a.startDate ?? null)
    );
    return { events: sorted, complete: true };
  }
  const walked = await fetchOrganizationEventsSince(
    organizationId,
    ymdShift(dayYmd, -SPEEDHIVE_EVENT_LOOKBACK_DAYS)
  );
  return {
    events: walked.events.filter((e) => !e.startDate || e.startDate.slice(0, 10) <= dayYmd),
    complete: walked.complete,
  };
}

async function discoverSpeedhiveOrganizationSessionsForUser(input: {
  userId: string;
  trackSpeedhiveUrl: string;
  eventRaceClass?: string | null;
  dayYmd?: string | null;
  timeZone?: string | null;
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
      status: emptyLapDiscoveryStatus("invalid_url", "speedhive"),
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
      status: emptyLapDiscoveryStatus("no_identity", "speedhive", {
        timingPages: [{ source: "speedhive", url: organizationPageUrl(organizationId) }],
      }),
    };
  }

  const raceClassFilter = input.eventRaceClass?.trim().toLowerCase() ?? null;
  const discovered: SpeedhiveDiscoveredSession[] = [];
  let sawTransponderFields = false;
  // A named day needs the track's zone to read Speedhive's wall-clock session times.
  const dayYmd = input.dayYmd?.trim() && input.timeZone ? input.dayYmd.trim() : null;
  const zone = input.timeZone ?? "UTC";
  let incomplete = false;

  try {
    const { events: sortedEvents, complete } = await eventsForDiscovery(organizationId, dayYmd);
    if (!complete) incomplete = true;

    for (const event of sortedEvents) {
      if (!event.id) continue;
      const eventSessions = await fetchEventSessions(event.id);
      const eventYmd = event.startDate?.slice(0, 10) ?? null;
      const sessions = dayYmd
        ? eventSessions.filter((s) => (speedhiveSessionLocalYmd(s.startTime, zone) ?? eventYmd) === dayYmd)
        : eventSessions.slice(0, MAX_SESSIONS_PER_EVENT);

      for (const sess of sessions) {
        if (!sess.id) continue;
        let classification;
        try {
          classification = await fetchSessionClassification(sess.id);
        } catch {
          // Unread, not a race the driver was absent from.
          if (dayYmd) incomplete = true;
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

        // The track's clock as-if-UTC, the convention the imported result keeps (`labels.ts`); a
        // session with no time of its own sits at midday on its meeting's date.
        const meetingYmd = eventYmd ?? dayYmd;
        const completedIso =
          speedhiveSessionWallClockIso(sess.startTime) ??
          (meetingYmd ? `${meetingYmd}T12:00:00.000Z` : null);

        const kind: "practice" | "race" =
          sess.type?.toLowerCase() === "practice" ? "practice" : "race";

        discovered.push({
          sessionUrl: buildSessionPageUrl(event.id, sess.id),
          chipCode: userChipOnClassificationRow(match, userTransponders),
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
      status: emptyLapDiscoveryStatus("unreachable", "speedhive", {
        timingPages: [{ source: "speedhive", url: organizationPageUrl(organizationId) }],
      }),
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

  /**
   * MYLAPS results state.
   *
   * Race results are read from LiveRC in this product; a MYLAPS organization page is the fallback
   * for clubs that publish nowhere else. `sawTransponderFields` is the one distinction worth
   * keeping: where a club posts results without a transponder column, the number in Settings cannot
   * match anything and telling a driver to go and check it wastes their time.
   */
  const status: LapDiscoveryStatus | null =
    unimported.length > 0
      ? null
      : {
          code: sorted.length > 0 ? "all_imported" : "no_match",
          sources: ["speedhive"],
          postedCount: sorted.length,
          matchedCount: sorted.length,
          timingPages: [{ source: "speedhive", url: organizationPageUrl(organizationId) }],
          sessionsToday: [],
          transponderNotPublished: userTransponders.length > 0 && !sawTransponderFields,
        };

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
    status,
    incomplete,
  };
}

function organizationPageUrl(organizationId: number): string {
  return `https://speedhive.mylaps.com/organizations/${organizationId}`;
}
