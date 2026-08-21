import "server-only";

import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { discoverLiveRcSessionsForUser } from "@/lib/lapWatch/discoverLiveRcSessionsForUser";
import { discoverSpeedhiveSessionsForUser } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";
import {
  emptyLapDiscoveryStatus,
  mergeLapDiscoveryStatuses,
  type LapDiscoveryStatus,
} from "@/lib/lapWatch/lapDiscoveryStatus";

export type TrackTimingDiscoveredSession = {
  sessionId: string;
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  label: string;
  bestLapSeconds?: number | null;
  alreadyImported: boolean;
  linkedRunId: string | null;
  timingSource: "liverc" | "speedhive";
};

export async function discoverTrackTimingSessions(input: {
  userId: string;
  liveRcUrl: string | null;
  speedhiveUrl: string | null;
  eventRaceClass?: string | null;
  referenceDate?: Date;
  /**
   * Recency window start (caller's local start-of-day). Unimported sessions completed before this
   * (or with no timestamp) are returned separately as `olderUnimportedCandidates` so the picker can
   * collapse a first-scan backlog instead of listing months of history as "to import".
   */
  visibleSinceIso?: string | null;
}): Promise<{
  candidates: TrackTimingDiscoveredSession[];
  unimportedCandidates: TrackTimingDiscoveredSession[];
  unimportedTotal: number;
  olderUnimportedCandidates: TrackTimingDiscoveredSession[];
  olderUnimportedTotal: number;
  mostRecentSession: TrackTimingDiscoveredSession | null;
  liveRcDriverName: string | null;
  hint: string | null;
  /** The same finding in the pieces the card lays out; null when there is something to import. */
  status: LapDiscoveryStatus | null;
  liveRcDebug: unknown;
  speedhiveOrganizationId: number | null;
  speedhivePracticeLocationId: number | null;
  activeRaceMeeting: {
    detected: boolean;
    eventHubUrl: string | null;
    eventLabel: string | null;
  };
}> {
  const liveRc = input.liveRcUrl?.trim() ?? "";
  const speedhive = input.speedhiveUrl?.trim() ?? "";

  if (!liveRc && !speedhive) {
    return {
      candidates: [],
      unimportedCandidates: [],
      unimportedTotal: 0,
      olderUnimportedCandidates: [],
      olderUnimportedTotal: 0,
      mostRecentSession: null,
      liveRcDriverName: null,
      hint: "Add a LiveRC or Speedhive organization URL on the track page.",
      status: emptyLapDiscoveryStatus("no_timing_page", "liverc", { sources: [] }),
      liveRcDebug: null,
      speedhiveOrganizationId: null,
      speedhivePracticeLocationId: null,
      activeRaceMeeting: { detected: false, eventHubUrl: null, eventLabel: null },
    };
  }

  const liveRcDriverName = await getLiveRcDriverNameSetting(input.userId);

  const [lr, sh] = await Promise.all([
    liveRc
      ? discoverLiveRcSessionsForUser({
          userId: input.userId,
          trackLiveRcUrl: liveRc,
          eventRaceClass: input.eventRaceClass,
          referenceDate: input.referenceDate,
        })
      : null,
    speedhive
      ? discoverSpeedhiveSessionsForUser({
          userId: input.userId,
          trackSpeedhiveUrl: speedhive,
          eventRaceClass: input.eventRaceClass,
        })
      : null,
  ]);

  const merged: TrackTimingDiscoveredSession[] = [
    ...(lr?.candidates.map((c) => ({
      sessionId: c.sessionId,
      sessionUrl: c.sessionUrl,
      sessionCompletedAtIso: c.sessionCompletedAtIso,
      label: c.label,
      bestLapSeconds: null,
      alreadyImported: c.alreadyImported,
      linkedRunId: c.linkedRunId,
      timingSource: "liverc" as const,
    })) ?? []),
    ...(sh?.candidates ?? []),
  ];

  merged.sort((a, b) => {
    const ta = a.sessionCompletedAtIso ? new Date(a.sessionCompletedAtIso).getTime() : 0;
    const tb = b.sessionCompletedAtIso ? new Date(b.sessionCompletedAtIso).getTime() : 0;
    return tb - ta;
  });

  const unimported = merged.filter((c) => !c.alreadyImported);

  const visibleSinceParsed = input.visibleSinceIso ? new Date(input.visibleSinceIso) : null;
  const visibleSinceMs =
    visibleSinceParsed && !Number.isNaN(visibleSinceParsed.getTime())
      ? visibleSinceParsed.getTime()
      : null;
  const isWithinWindow = (c: TrackTimingDiscoveredSession): boolean => {
    if (visibleSinceMs == null) return true;
    if (!c.sessionCompletedAtIso) return false;
    const t = new Date(c.sessionCompletedAtIso).getTime();
    return Number.isFinite(t) && t >= visibleSinceMs;
  };
  const fresh = unimported.filter(isWithinWindow);
  const older = unimported.filter((c) => !isWithinWindow(c));

  const MAX_RECENT_RUNS = 10;
  const MAX_OLDER_RUNS = 30;
  const unimportedRecent = fresh.slice(0, MAX_RECENT_RUNS);
  const hints = [lr?.hint, sh?.hint].filter(Boolean) as string[];

  // Both sources get a say. Taking the first hint meant a track carrying LiveRC and MYLAPS reported
  // whichever was listed first: fourteen LiveRC sessions posted under a name you'd typo'd, and the
  // card would tell you MYLAPS had nothing. The merge ranks by what the driver can act on.
  const status = mergeLapDiscoveryStatuses([lr?.status, sh?.status]);

  return {
    candidates: merged,
    unimportedCandidates: unimportedRecent,
    unimportedTotal: fresh.length,
    olderUnimportedCandidates: older.slice(0, MAX_OLDER_RUNS),
    olderUnimportedTotal: older.length,
    mostRecentSession: unimportedRecent[0] ?? merged[0] ?? null,
    liveRcDriverName,
    hint: unimported.length > 0 ? null : hints[0] ?? null,
    status,
    liveRcDebug: lr?.debug ?? null,
    speedhiveOrganizationId: sh?.organizationId ?? null,
    speedhivePracticeLocationId: sh?.practiceLocationId ?? null,
    activeRaceMeeting: lr?.activeRaceMeeting ?? {
      detected: false,
      eventHubUrl: null,
      eventLabel: null,
    },
  };
}
