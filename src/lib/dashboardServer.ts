import type { ActionItemSourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DashboardNewRunPrefill, DashboardSerializedRun } from "@/lib/dashboardPrefillTypes";
import { computeIncludedLapMetricsFromRun } from "@/lib/lapAnalysis";
import { displayRunNotes } from "@/lib/runNotes";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { eventIsActiveOnLocalToday, startOfLocalDay } from "@/lib/eventActive";
import { loadDetectedRunPrompts, syncRecentEventLapSources } from "@/lib/eventLapDetection/syncEventLapSources";
import type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";

export type { DashboardNewRunPrefill, DashboardSerializedRun } from "@/lib/dashboardPrefillTypes";
export type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";

/** @deprecated import from `@/lib/eventActive` */
export { eventIsActiveOnLocalToday } from "@/lib/eventActive";

function localTodayBounds(): { start: Date; end: Date } {
  const start = startOfLocalDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

const runPrefillInclude = {
  track: { select: { id: true, name: true } },
  car: { select: { id: true, name: true } },
  tireSet: { select: { id: true, label: true, setNumber: true } },
  battery: { select: { id: true, label: true, packNumber: true } },
  event: {
    select: {
      id: true,
      name: true,
      trackId: true,
      startDate: true,
      endDate: true,
      notes: true,
      track: { select: { id: true, name: true, location: true } },
    },
  },
  setupSnapshot: { select: { id: true, data: true } },
} as const;

function serializeRunForPrefill(
  run: {
    id: string;
    createdAt: Date;
    sessionType: "TESTING" | "PRACTICE" | "RACE_MEETING";
    meetingSessionType: string | null;
    meetingSessionCode: string | null;
    carId: string | null;
    car: { id: string; name: string } | null;
    trackId: string | null;
    eventId: string | null;
    tireSetId: string | null;
    tireRunNumber: number;
    batteryId: string | null;
    batteryRunNumber: number;
    setupSnapshot: { id: string; data: unknown };
    event: {
      id: string;
      name: string;
      trackId: string | null;
      startDate: Date;
      endDate: Date;
      notes: string | null;
      track: { id: string; name: string; location: string | null } | null;
    } | null;
    track: { id: string; name: string } | null;
    tireSet: { id: string; label: string; setNumber: number | null } | null;
    battery: { id: string; label: string; packNumber: number | null } | null;
    notes: string | null;
    driverNotes: string | null;
    handlingProblems: string | null;
    suggestedChanges: string | null;
    lapTimes: unknown;
    lapSession: unknown;
  }
): DashboardSerializedRun {
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    sessionType: run.sessionType,
    meetingSessionType: run.meetingSessionType,
    meetingSessionCode: run.meetingSessionCode,
    carId: run.carId ?? undefined,
    car: run.car,
    trackId: run.trackId,
    eventId: run.eventId,
    tireSetId: run.tireSetId,
    tireRunNumber: run.tireRunNumber,
    batteryId: run.batteryId,
    batteryRunNumber: run.batteryRunNumber,
    setupSnapshot: run.setupSnapshot,
    event: run.event
      ? {
          ...run.event,
          startDate: run.event.startDate.toISOString(),
          endDate: run.event.endDate.toISOString(),
        }
      : null,
    track: run.track,
    tireSet: run.tireSet,
    battery: run.battery,
    notes: run.notes,
    driverNotes: run.driverNotes,
    handlingProblems: run.handlingProblems,
    suggestedChanges: run.suggestedChanges,
    lapTimes: run.lapTimes,
    lapSession: run.lapSession,
  };
}

export async function getDashboardNewRunPrefill(
  userId: string,
  raw: Record<string, string | string[] | undefined>
): Promise<DashboardNewRunPrefill | null> {
  const importedLapTimeSessionId =
    typeof raw.importedLapTimeSessionId === "string" ? raw.importedLapTimeSessionId.trim() : "";
  if (importedLapTimeSessionId) {
    const [sess, liveRcDriverName] = await Promise.all([
      prisma.importedLapTimeSession.findFirst({
        where: { id: importedLapTimeSessionId, userId },
        select: {
          id: true,
          sourceUrl: true,
          parserId: true,
          sessionCompletedAt: true,
          parsedPayload: true,
          createdAt: true,
          eventDetectionSource: true,
          linkedEventId: true,
        },
      }),
      getLiveRcDriverNameSetting(userId),
    ]);
    if (!sess) return null;
    const src = sess.eventDetectionSource;
    const eventDetectionSource = src === "practice" || src === "race" ? src : null;
    return {
      mode: "imported_lap_session",
      importedLapTimeSession: {
        id: sess.id,
        sourceUrl: sess.sourceUrl,
        parserId: sess.parserId,
        sessionCompletedAtIso: sess.sessionCompletedAt ? sess.sessionCompletedAt.toISOString() : null,
        parsedPayload: sess.parsedPayload,
        createdAt: sess.createdAt.toISOString(),
        eventDetectionSource,
        linkedEventId: sess.linkedEventId,
        liveRcDriverName,
      },
      fromEventDetection: eventDetectionSource === "practice" || eventDetectionSource === "race",
    };
  }

  const from = typeof raw.fromDashboard === "string" ? raw.fromDashboard : undefined;
  const eventId = typeof raw.eventId === "string" ? raw.eventId : undefined;
  if (!from || !eventId) return null;

  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    select: { id: true, trackId: true },
  });
  if (!event) return null;

  if (from === "first") {
    return { mode: "first", eventId: event.id, trackId: event.trackId };
  }

  if (from === "continue") {
    const run = await prisma.run.findFirst({
      where: { userId, eventId: event.id },
      orderBy: { createdAt: "desc" },
      include: runPrefillInclude,
    });
    if (!run) {
      return { mode: "first", eventId: event.id, trackId: event.trackId };
    }
    return { mode: "continue", run: serializeRunForPrefill(run) };
  }

  return null;
}

export type DashboardActionItemRow = {
  id: string;
  text: string;
  sourceType: "RUN" | "MANUAL";
  createdAt: string;
  sourceRunId: string | null;
};

export type DashboardIncompleteRunRow = {
  id: string;
  createdAt: string;
  sessionCompletedAt: string | null;
  carName: string;
  trackName: string | null;
  eventName: string | null;
  sessionLabel: string;
};

export type DashboardHomeModel = {
  detectedRunPrompts: DetectedRunPrompt[];
  /** Saved runs where the user has not clicked "Run completed" yet. */
  incompleteRuns: DashboardIncompleteRunRow[];
  thingsToTry: DashboardActionItemRow[];
  activeEvent: null | {
    id: string;
    name: string;
    trackLabel: string | null;
    runCount: number;
    latest: null | {
      bestLap: number | null;
      avgTop5: number | null;
      notesPreview: string | null;
    };
  };
  hasRunToday: boolean;
  perfBestLap: number | null;
  perfAvgTop5: number | null;
  recentRun: null | {
    id: string;
    createdAt: string;
    sessionCompletedAt: string | null;
    carName: string;
    trackName: string | null;
    eventName: string | null;
    sessionLabel: string;
    bestLap: number | null;
    avgTop5: number | null;
  };
};

const recentRunSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  lapTimes: true,
  lapSession: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  car: { select: { id: true, name: true } },
  track: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
} as const;

const incompleteRunSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  car: { select: { name: true } },
  track: { select: { name: true } },
  event: { select: { name: true } },
} as const;

function toDashboardIncompleteRunRow(
  r: {
    id: string;
    createdAt: Date;
    sessionCompletedAt: Date | null;
    sessionType: string;
    meetingSessionType: string | null;
    meetingSessionCode: string | null;
    sessionLabel: string | null;
    car: { name: string } | null;
    track: { name: string } | null;
    event: { name: string } | null;
  }
): DashboardIncompleteRunRow {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    sessionCompletedAt: r.sessionCompletedAt ? r.sessionCompletedAt.toISOString() : null,
    carName: r.car?.name ?? "—",
    trackName: r.track?.name ?? null,
    eventName: r.event?.name ?? null,
    sessionLabel: formatRunSessionDisplay({
      sessionType: r.sessionType,
      meetingSessionType: r.meetingSessionType,
      meetingSessionCode: r.meetingSessionCode,
      sessionLabel: r.sessionLabel,
    }),
  };
}

/**
 * Incomplete runs for linking a LiveRC import to an existing draft (same event first, then any).
 */
export async function loadIncompleteRunsForImportChooser(
  userId: string,
  eventId: string | null
): Promise<DashboardIncompleteRunRow[]> {
  const baseWhere = {
    userId,
    loggingComplete: false as const,
    incompleteLoggingPromptDismissedAt: null,
  };
  let rows = await prisma.run.findMany({
    where: eventId ? { ...baseWhere, eventId } : baseWhere,
    orderBy: { createdAt: "desc" },
    take: 15,
    select: incompleteRunSelect,
  });
  if (rows.length === 0 && eventId) {
    rows = await prisma.run.findMany({
      where: baseWhere,
      orderBy: { createdAt: "desc" },
      take: 15,
      select: incompleteRunSelect,
    });
  }
  return rows.map(toDashboardIncompleteRunRow);
}

export async function loadDashboardHomeModel(userId: string): Promise<DashboardHomeModel> {
  const { start: todayStart, end: todayEnd } = localTodayBounds();

  await syncRecentEventLapSources(userId).catch(() => {});
  const detectedRunPrompts = await loadDetectedRunPrompts(userId);

  const [events, hasRunToday, recentRun, runsForPerf, incompleteRunsRows] = await Promise.all([
    prisma.event.findMany({
      where: { userId },
      orderBy: { startDate: "desc" },
      take: 80,
      include: { track: { select: { id: true, name: true, location: true } } },
    }),
    prisma.run.findFirst({
      where: { userId, createdAt: { gte: todayStart, lt: todayEnd } },
      select: { id: true },
    }),
    prisma.run.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: recentRunSelect,
    }),
    prisma.run.findMany({
      where: { userId },
      select: { lapTimes: true, lapSession: true },
      take: 400,
      orderBy: { createdAt: "desc" },
    }),
    prisma.run.findMany({
      where: { userId, loggingComplete: false, incompleteLoggingPromptDismissedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: incompleteRunSelect,
    }),
  ]);

  let actionItems: Array<{
    id: string;
    createdAt: Date;
    text: string;
    sourceType: ActionItemSourceType;
    sourceRunId: string | null;
  }> = [];
  try {
    actionItems = await prisma.actionItem.findMany({
      where: { userId, isArchived: false },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: {
        id: true,
        text: true,
        sourceType: true,
        createdAt: true,
        sourceRunId: true,
      },
    });
  } catch {
    actionItems = [];
  }

  const activeCandidates = events.filter(eventIsActiveOnLocalToday);
  const activeEvent =
    activeCandidates.length === 0
      ? null
      : activeCandidates.reduce((a, b) =>
          new Date(a.startDate).getTime() >= new Date(b.startDate).getTime() ? a : b
        );

  let activeBlock: DashboardHomeModel["activeEvent"] = null;
  if (activeEvent) {
    const [runCount, latestRun] = await Promise.all([
      prisma.run.count({ where: { userId, eventId: activeEvent.id } }),
      prisma.run.findFirst({
        where: { userId, eventId: activeEvent.id },
        orderBy: { createdAt: "desc" },
        select: {
    lapTimes: true,
    lapSession: true,
    notes: true,
    driverNotes: true,
    handlingProblems: true,
        },
      }),
    ]);

    const track = activeEvent.track;
    const trackLabel = track
      ? `${track.name}${track.location ? ` (${track.location})` : ""}`
      : null;

    let latest: {
      bestLap: number | null;
      avgTop5: number | null;
      notesPreview: string | null;
    } | null = null;
    if (latestRun) {
      const m = computeIncludedLapMetricsFromRun(latestRun);
      const fullNotes = displayRunNotes(latestRun);
      const notesPreview =
        fullNotes.length > 100 ? `${fullNotes.slice(0, 97).trimEnd()}…` : fullNotes || null;
      latest = {
        bestLap: m.bestLap,
        avgTop5: m.averageTop5,
        notesPreview,
      };
    }

    activeBlock = {
      id: activeEvent.id,
      name: activeEvent.name,
      trackLabel,
      runCount,
      latest,
    };
  }

  let perfBestLap: number | null = null;
  let perfAvgTop5: number | null = null;
  for (const r of runsForPerf) {
    const m = computeIncludedLapMetricsFromRun(r);
    if (m.bestLap != null) {
      if (perfBestLap == null || m.bestLap < perfBestLap) {
        perfBestLap = m.bestLap;
        perfAvgTop5 = m.averageTop5;
      }
    }
  }

  let recent: DashboardHomeModel["recentRun"] = null;
  if (recentRun) {
    const m = computeIncludedLapMetricsFromRun(recentRun);
    recent = {
      id: recentRun.id,
      createdAt: recentRun.createdAt.toISOString(),
      sessionCompletedAt: recentRun.sessionCompletedAt
        ? recentRun.sessionCompletedAt.toISOString()
        : null,
      carName: recentRun.car?.name ?? "—",
      trackName: recentRun.track?.name ?? null,
      eventName: recentRun.event?.name ?? null,
      sessionLabel: formatRunSessionDisplay(recentRun),
      bestLap: m.bestLap,
      avgTop5: m.averageTop5,
    };
  }

  const incompleteRuns: DashboardIncompleteRunRow[] = incompleteRunsRows.map(toDashboardIncompleteRunRow);

  return {
    detectedRunPrompts,
    incompleteRuns,
    thingsToTry: actionItems.map((i) => ({
      id: i.id,
      text: i.text,
      sourceType: i.sourceType,
      createdAt: i.createdAt.toISOString(),
      sourceRunId: i.sourceRunId,
    })),
    activeEvent: activeBlock,
    hasRunToday: Boolean(hasRunToday),
    perfBestLap,
    perfAvgTop5,
    recentRun: recent,
  };
}
