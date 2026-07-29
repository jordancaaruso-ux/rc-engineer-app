import { prisma } from "@/lib/prisma";
import { userCanAccessEvent } from "@/lib/events/eventParticipation";
import { importedSessionFieldStatsV1FromJson } from "@/lib/lapImport/importedTimingFieldStatsForEngineer";
import { formatRunSessionDisplay } from "@/lib/runSession";
import {
  shapeEventAnchorDigest,
  type EventAnchorDigestV1,
  type EventDigestFieldStatLineV1,
} from "@/lib/engineerPhase5/eventAnchorDigestShape";

/**
 * DB loader for the event (race meeting) anchor — compact digest of the user's runs
 * at the meeting plus top-line imported timing stats. Pure shaping (and the size
 * caps) live in eventAnchorDigestShape.ts.
 */

export async function buildEventAnchorDigest(params: {
  userId: string;
  eventId: string;
  timeZone?: string | null;
}): Promise<EventAnchorDigestV1 | null> {
  // Events are global rows — access is participation or having a run there.
  if (!(await userCanAccessEvent(params.userId, params.eventId))) return null;

  const event = await prisma.event.findUnique({
    where: { id: params.eventId },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      trackNameSnapshot: true,
      track: { select: { name: true } },
    },
  });
  if (!event) return null;

  const [runs, timingSessions] = await Promise.all([
    prisma.run.findMany({
      where: { userId: params.userId, eventId: params.eventId },
      orderBy: { sortAt: "asc" },
      take: 60,
      select: {
        id: true,
        createdAt: true,
        sessionCompletedAt: true,
        sessionLabel: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        carId: true,
        carNameSnapshot: true,
        car: { select: { name: true } },
        lapTimes: true,
        bestLapSeconds: true,
        avgTop5LapSeconds: true,
        carRating: true,
        tireType: { select: { displayName: true } },
        setupSnapshot: { select: { data: true } },
      },
    }),
    prisma.importedLapTimeSession.findMany({
      where: { userId: params.userId, linkedEventId: params.eventId },
      orderBy: [{ sessionCompletedAt: "asc" }, { createdAt: "asc" }],
      take: 20,
      select: {
        fieldStatsJson: true,
        eventDetectionSessionLabel: true,
        linkedRunId: true,
      },
    }),
  ]);

  const tz = params.timeZone?.trim() || undefined;
  const whenFmt = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
  const dateFmt = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(tz ? { timeZone: tz } : {}),
  });

  const bestByRunId = new Map(runs.map((run) => [run.id, run.bestLapSeconds]));

  const importedFieldStats: EventDigestFieldStatLineV1[] = [];
  for (const session of timingSessions) {
    const stats = importedSessionFieldStatsV1FromJson(session.fieldStatsJson);
    if (!stats) continue;
    const yourBest = session.linkedRunId ? bestByRunId.get(session.linkedRunId) ?? null : null;
    const finiteBests = stats.drivers
      .map((d) => d.bestLapSeconds)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    importedFieldStats.push({
      sessionLabel: session.eventDetectionSessionLabel ?? null,
      driverCount: stats.driverCount,
      yourRank:
        yourBest != null && finiteBests.length > 0
          ? 1 + finiteBests.filter((v) => v < yourBest).length
          : null,
      gapBestVsFieldMeanSeconds:
        yourBest != null && stats.field.meanBestSeconds != null
          ? Number((yourBest - stats.field.meanBestSeconds).toFixed(3))
          : null,
    });
  }

  return shapeEventAnchorDigest({
    eventId: event.id,
    name: event.name,
    trackName: event.track?.name ?? event.trackNameSnapshot ?? null,
    dateRangeLabel:
      dateFmt.format(event.startDate) === dateFmt.format(event.endDate)
        ? dateFmt.format(event.startDate)
        : `${dateFmt.format(event.startDate)} – ${dateFmt.format(event.endDate)}`,
    runsChronological: runs.map((run) => ({
      id: run.id,
      whenLabel: whenFmt.format(run.sessionCompletedAt ?? run.createdAt),
      sessionLabel: formatRunSessionDisplay(run, { fallback: "Run" }),
      carId: run.carId,
      carName: run.car?.name ?? run.carNameSnapshot ?? null,
      lapCount: Array.isArray(run.lapTimes) ? run.lapTimes.length : null,
      bestLapSeconds: run.bestLapSeconds,
      avgTop5Seconds: run.avgTop5LapSeconds,
      tireLabel: run.tireType?.displayName ?? null,
      carRating: run.carRating,
      snapshotData: run.setupSnapshot?.data,
    })),
    importedFieldStats,
  });
}

/** Rich context for an event pin anchors to the latest own run at the meeting. */
export async function resolveEventAnchorDerivedRunId(params: {
  userId: string;
  eventId: string;
}): Promise<string | null> {
  const run = await prisma.run.findFirst({
    where: { userId: params.userId, eventId: params.eventId },
    orderBy: { sortAt: "desc" },
    select: { id: true },
  });
  return run?.id ?? null;
}
