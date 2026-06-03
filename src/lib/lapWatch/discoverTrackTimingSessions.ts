import "server-only";

import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { discoverLiveRcSessionsForUser } from "@/lib/lapWatch/discoverLiveRcSessionsForUser";
import { discoverMylapsLinkedSessions } from "@/lib/mylaps/discoverMylapsLinkedSessions";
import { hasMylapsConnection } from "@/lib/mylaps/mylapsConnection";
import { discoverSpeedhiveSessionsForUser } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";

export type TrackTimingDiscoveredSession = {
  sessionId: string;
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  label: string;
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
  mostRecentSession: TrackTimingDiscoveredSession | null;
  liveRcDriverName: string | null;
  hint: string | null;
  liveRcDebug: unknown;
  speedhiveOrganizationId: number | null;
  activeRaceMeeting: {
    detected: boolean;
    eventHubUrl: string | null;
    eventLabel: string | null;
  };
}> {
  const liveRc = input.liveRcUrl?.trim() ?? "";
  const speedhive = input.speedhiveUrl?.trim() ?? "";
  const mylapsLinked = await hasMylapsConnection(input.userId);

  if (!liveRc && !speedhive && !mylapsLinked) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      liveRcDriverName: null,
      hint:
        "Link your MYLAPS account in Settings, or add a LiveRC / Speedhive URL on the track page.",
      liveRcDebug: null,
      speedhiveOrganizationId: null,
      activeRaceMeeting: { detected: false, eventHubUrl: null, eventLabel: null },
    };
  }

  const liveRcDriverName = await getLiveRcDriverNameSetting(input.userId);

  const [lr, sh, ml] = await Promise.all([
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
    mylapsLinked
      ? discoverMylapsLinkedSessions({
          userId: input.userId,
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
      alreadyImported: c.alreadyImported,
      linkedRunId: c.linkedRunId,
      timingSource: "liverc" as const,
    })) ?? []),
    ...(sh?.candidates ?? []),
    ...(ml?.candidates ?? []),
  ];

  merged.sort((a, b) => {
    const ta = a.sessionCompletedAtIso ? new Date(a.sessionCompletedAtIso).getTime() : 0;
    const tb = b.sessionCompletedAtIso ? new Date(b.sessionCompletedAtIso).getTime() : 0;
    return tb - ta;
  });

  const unimported = merged.filter((c) => !c.alreadyImported);
  const hints = [lr?.hint, sh?.hint, ml?.hint].filter(Boolean) as string[];

  return {
    candidates: merged,
    unimportedCandidates: unimported,
    mostRecentSession: unimported[0] ?? merged[0] ?? null,
    liveRcDriverName,
    hint: unimported.length > 0 ? null : hints[0] ?? null,
    liveRcDebug: lr?.debug ?? null,
    speedhiveOrganizationId: sh?.organizationId ?? null,
    activeRaceMeeting: lr?.activeRaceMeeting ?? {
      detected: false,
      eventHubUrl: null,
      eventLabel: null,
    },
  };
}
