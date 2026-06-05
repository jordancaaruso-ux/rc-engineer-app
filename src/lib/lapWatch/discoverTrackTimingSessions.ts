import "server-only";

import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { discoverLiveRcSessionsForUser } from "@/lib/lapWatch/discoverLiveRcSessionsForUser";
import { discoverSpeedhiveSessionsForUser } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";

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
}): Promise<{
  candidates: TrackTimingDiscoveredSession[];
  unimportedCandidates: TrackTimingDiscoveredSession[];
  unimportedTotal: number;
  mostRecentSession: TrackTimingDiscoveredSession | null;
  liveRcDriverName: string | null;
  hint: string | null;
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
      mostRecentSession: null,
      liveRcDriverName: null,
      hint: "Add a LiveRC or Speedhive organization URL on the track page.",
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
  const MAX_RECENT_RUNS = 10;
  const unimportedRecent = unimported.slice(0, MAX_RECENT_RUNS);
  const hints = [lr?.hint, sh?.hint].filter(Boolean) as string[];

  return {
    candidates: merged,
    unimportedCandidates: unimportedRecent,
    unimportedTotal: unimported.length,
    mostRecentSession: unimportedRecent[0] ?? merged[0] ?? null,
    liveRcDriverName,
    hint: unimportedRecent.length > 0 ? null : hints[0] ?? null,
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
