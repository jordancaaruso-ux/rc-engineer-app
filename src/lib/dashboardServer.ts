import type { ActionItemSourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DashboardNewRunPrefill, DashboardSerializedRun } from "@/lib/dashboardPrefillTypes";
import { computeIncludedLapMetricsFromRun, getIncludedLaps, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { computeDashboardSummary, type DashboardSummary, type SummaryRunInput } from "@/lib/dashboardSummary";
import {
  computeDashboardRecords,
  type DashboardNewPb,
  type DashboardRecord,
  type RecordRunInput,
} from "@/lib/dashboardRecords";
import { displayRunNotes } from "@/lib/runNotes";
import { formatRunSessionDisplay } from "@/lib/runSession";
import {
  formatHandlingAssessmentDetailLines,
  formatPrimaryFocusLine,
  parseHandlingAssessmentJson,
} from "@/lib/runHandlingAssessment";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { pickFeaturedEvent } from "@/lib/eventActive";
import { calendarYmdInTimeZone, formatFeaturedEventDateLabel } from "@/lib/formatDate";
import { syncRecentEventLapSources } from "@/lib/eventLapDetection/syncEventLapSources";
import { loadUserScopedEvents, userCanAccessEvent } from "@/lib/events/eventParticipation";
import { resolveEventTrackLabel } from "@/lib/tracks/legacyTrackSnapshot";
import { getLiveRcDriverIdSetting, getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { DashboardEngineerSuggestionPayloadV1 } from "@/lib/engineerPhase5/dashboardSuggestions/dashboardSuggestionTypes";
import { perfSpan } from "@/lib/perfLog";

export type { DashboardNewRunPrefill, DashboardSerializedRun } from "@/lib/dashboardPrefillTypes";
export type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";

/** @deprecated import from `@/lib/eventActive` */
export { eventIsActiveOnLocalToday, eventIsActiveOnCalendarDay } from "@/lib/eventActive";

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function localTodayBounds(): { start: Date; end: Date } {
  const start = startOfLocalDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

const runPrefillInclude = (userId: string) =>
  ({
  track: { select: { id: true, name: true } },
  trackLayout: { select: { id: true, name: true } },
  car: { select: { id: true, name: true } },
  tireSet: { select: { id: true, label: true, setNumber: true } },
  event: {
    select: {
      id: true,
      name: true,
      trackId: true,
      startDate: true,
      endDate: true,
      track: { select: { id: true, name: true, location: true } },
      participations: {
        where: { userId },
        select: { notes: true },
        take: 1,
      },
    },
  },
  setupSnapshot: { select: { id: true, data: true } },
} as const);

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
    trackLayoutId: string | null;
    trackLayout: { id: string; name: string } | null;
    trackDirection: "CW" | "CCW" | null;
    eventId: string | null;
    tireSetId: string | null;
    tireRunNumber: number;
    setupSnapshot: { id: string; data: unknown };
    event: {
      id: string;
      name: string;
      trackId: string | null;
      startDate: Date;
      endDate: Date;
      track: { id: string; name: string; location: string | null } | null;
      participations: Array<{ notes: string | null }>;
    } | null;
    track: { id: string; name: string } | null;
    tireSet: { id: string; label: string; setNumber: number | null } | null;
    notes: string | null;
    driverNotes: string | null;
    handlingProblems: string | null;
    suggestedChanges: string | null;
    practiceDayUrl?: string | null;
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
    trackLayoutId: run.trackLayoutId,
    trackLayout: run.trackLayout,
    trackDirection: run.trackDirection,
    eventId: run.eventId,
    tireSetId: run.tireSetId,
    tireRunNumber: run.tireRunNumber,
    setupSnapshot: run.setupSnapshot,
    event: run.event
      ? {
          id: run.event.id,
          name: run.event.name,
          trackId: run.event.trackId,
          startDate: run.event.startDate.toISOString(),
          endDate: run.event.endDate.toISOString(),
          notes: run.event.participations[0]?.notes ?? null,
          track: run.event.track,
        }
      : null,
    track: run.track,
    tireSet: run.tireSet,
    notes: run.notes,
    driverNotes: run.driverNotes,
    handlingProblems: run.handlingProblems,
    suggestedChanges: run.suggestedChanges,
    practiceDayUrl: run.practiceDayUrl ?? null,
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
    const [sess, liveRcDriverName, liveRcDriverId] = await Promise.all([
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
      getLiveRcDriverIdSetting(userId),
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
        liveRcDriverId,
      },
      fromEventDetection: eventDetectionSource === "practice" || eventDetectionSource === "race",
    };
  }

  const from = typeof raw.fromDashboard === "string" ? raw.fromDashboard : undefined;
  const eventId = typeof raw.eventId === "string" ? raw.eventId : undefined;
  if (!from || !eventId) return null;

  const event = await prisma.event.findFirst({
    where: { id: eventId },
    select: { id: true, trackId: true },
  });
  if (!event || !(await userCanAccessEvent(userId, eventId))) return null;

  if (from === "first") {
    return { mode: "first", eventId: event.id, trackId: event.trackId };
  }

  if (from === "continue") {
    const run = await prisma.run.findFirst({
      where: { userId, eventId: event.id },
      orderBy: { createdAt: "desc" },
      include: runPrefillInclude(userId),
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
  /** Saved runs where the user has not clicked "Run completed" yet. */
  incompleteRuns: DashboardIncompleteRunRow[];
  thingsToTry: DashboardActionItemRow[];
  /** Pre–next-run checks / reminders (same rows as `ActionItem` `THINGS_TO_DO`). */
  thingsToDo: DashboardActionItemRow[];
  featuredEvent: null | {
    id: string;
    name: string;
    trackLabel: string | null;
    status: "active" | "next" | "last";
    startDate: string;
    endDate: string;
    dateLabel: string;
    runCount: number;
    /** Calendar days until the event starts in the user's zone (0 = today); null unless status is "next". */
    daysUntilStart: number | null;
    /** Most recent completed session day at the event's track — the "what you ran there last time" line. */
    lastVisit: null | {
      dateIso: string;
      bestLap: number | null;
      runCount: number;
    };
    latest: null | {
      bestLap: number | null;
      avgTop5: number | null;
      notesPreview: string | null;
    };
  };
  hasRunToday: boolean;
  /** Best lap recorded among runs logged today (not all-time). */
  todayBestLap: number | null;
  /** Avg top 5 from the today run that produced the best lap. */
  todayBestAvgTop5: number | null;
  /** Label describing which today run owns the best lap (e.g. "Q2 · Onroad"). */
  todayBestRunLabel: string | null;
  todayBestRunId: string | null;
  /** Number of runs logged today. */
  todayRunCount: number;
  /**
   * Most recent _incomplete_ (draft) run logged today, if one exists. Drives
   * the dashboard's contextual primary button ("Complete logging") so the
   * driver jumps straight back into whichever draft needs finishing instead
   * of being forced through the new-run flow first.
   */
  todayDraftRunId: string | null;
  /** ISO timestamp when today's draft was first saved — powers the "Saved X ago" label on the dashboard card. */
  todayDraftSavedAt: string | null;
  /** Per-run setup changes made today, chronological (first-of-day uses yesterday's last run as baseline). */
  todaysChanges: Array<{
    runId: string;
    when: string;
    runLabel: string;
    rows: Array<{
      key: string;
      label: string;
      unit: string;
      previous: string | null;
      current: string;
    }>;
  }>;
  /**
   * Track-day pit board: today's runs, latest first — one line per run with the
   * best/avg, the best-lap delta vs the run before it today, and what setup
   * changed going into it. Today-only by design (the dashboard's "now & next"
   * boundary — see docs/DASHBOARD_NORTH_STAR.md); depth lives in Sessions.
   */
  todayStrip: Array<{
    runId: string;
    when: string;
    runLabel: string;
    bestLap: number | null;
    avgTop5: number | null;
    lapCount: number;
    loggingComplete: boolean;
    /** Best-lap delta vs the previous run today (negative = faster); null on the first run of the day. */
    bestDeltaVsPrev: number | null;
    changedRows: Array<{
      key: string;
      label: string;
      unit: string;
      previous: string | null;
      current: string;
    }>;
  }>;
  /** Where today is happening — names the track-day header. From the latest run logged today. */
  todayContext: null | {
    trackName: string | null;
    eventName: string | null;
    carName: string | null;
  };
  /**
   * Off-day "last time out" digest: the most recent completed session day —
   * when/where, pace, pace vs the previous visit to the same track, plus how
   * the car felt and what changed on the final run (from `recentRun`).
   */
  lastSessionDigest: null | {
    dateIso: string;
    trackName: string | null;
    runCount: number;
    bestLap: number | null;
    /** Day-best delta vs the previous completed day at the same track (negative = faster). */
    bestDeltaVsPrevVisit: number | null;
    prevVisitDateIso: string | null;
  };
  recentRun: null | {
    id: string;
    carId: string | null;
    createdAt: string;
    sessionCompletedAt: string | null;
    loggingCompletedAt: string | null;
    /** True when the user finished the logging workflow (may be true while loggingCompletedAt is null on legacy rows). */
    loggingComplete: boolean;
    carName: string;
    trackName: string | null;
    eventName: string | null;
    sessionLabel: string;
    bestLap: number | null;
    avgTop5: number | null;
    /** Included (valid) lap count for the run. */
    lapCount: number;
    /** 1–10 car handling rating from the feedback section; null when not rated. */
    carRating: number | null;
    /** Human-readable structured handling read (feel vs last run, phase balance, trait axes, focus). */
    handlingLines: string[];
    /** Free-text handling notes, trimmed; null when empty. */
    handlingProblems: string | null;
    /** Setup changes vs the previous run's snapshot; null when this is the first run. */
    setupChanges: null | Array<{
      key: string;
      label: string;
      unit: string;
      previous: string | null;
      current: string;
    }>;
  };
  /** Rolling 30-day reflective summary (runs / laps / wheel time / cadence / per-track pace). */
  summary: DashboardSummary;
  /** All-time per-track+class records (best lap / avg-top-5 / race pace), most-recent track first. */
  records: DashboardRecord[];
  /** Set when the most recent completed run beat an existing record — drives the celebration surfaces. */
  newPb: DashboardNewPb | null;
  /** Cached dashboard Engineer suggestions for the latest run (peek on SSR). Client sync-fetches when null. */
  engineerSuggestionsInitial: DashboardEngineerSuggestionPayloadV1 | null;
  /** Latest run id eligible for dashboard Engineer suggestions (requires car + completed logging). */
  engineerSuggestionsPrimaryRunId: string | null;
};

const recentRunSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  loggingComplete: true,
  sortAt: true,
  lapTimes: true,
  lapSession: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carRating: true,
  handlingAssessmentJson: true,
  handlingProblems: true,
  setupSnapshot: { select: { id: true, data: true } },
  car: { select: { id: true, name: true } },
  track: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
} as const;

const incompleteRunSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  sortAt: true,
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
    sortAt: Date;
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
    orderBy: { sortAt: "desc" },
    take: 15,
    select: incompleteRunSelect,
  });
  if (rows.length === 0 && eventId) {
    rows = await prisma.run.findMany({
      where: baseWhere,
      orderBy: { sortAt: "desc" },
      take: 15,
      select: incompleteRunSelect,
    });
  }
  return rows.map(toDashboardIncompleteRunRow);
}

/**
 * Today's in-progress drafts, most recent first — for the "new run — tap to log it"
 * notification path (`/runs/new?resume=1`). Continuing one preserves any pre-run setup
 * the driver logged before the run; today-scoped so a stale draft from last week doesn't
 * get offered as the run they just completed.
 */
export async function loadTodaysIncompleteRuns(
  userId: string
): Promise<DashboardIncompleteRunRow[]> {
  const { start, end } = localTodayBounds();
  const rows = await prisma.run.findMany({
    where: {
      userId,
      loggingComplete: false,
      incompleteLoggingPromptDismissedAt: null,
      sortAt: { gte: start, lte: end },
    },
    orderBy: { sortAt: "desc" },
    take: 15,
    select: incompleteRunSelect,
  });
  return rows.map(toDashboardIncompleteRunRow);
}

export async function loadDashboardHomeModel(
  userId: string,
  timeZone: string
): Promise<DashboardHomeModel> {
  return perfSpan("loadDashboardHomeModel", async () => {
  const { start: todayStart, end: todayEnd } = localTodayBounds();
  // One completed-runs fetch feeds BOTH the rolling 30-day summary (it ignores
  // rows outside its window) AND the all-time records board (which genuinely
  // needs every run — a PB is forever). At current scale this is fine; if it
  // gets heavy, materialize a per-run race-pace column + a records rollup.

  // Fire-and-forget: LiveRC fetches + Prisma writes; can take 1–2s. Dashboard no
  // longer shows detected-session prompts, but background sync keeps event lap
  // sources fresh for next features / pages.
  void syncRecentEventLapSources(userId).catch(() => {});

  const [scopedEvents, recentRun, todaysRuns, priorRun, incompleteRunsRows, completedRunRows] = await Promise.all([
    loadUserScopedEvents({ userId, take: 40 }),
    prisma.run.findFirst({
      where: {
        userId,
        OR: [{ loggingCompletedAt: { not: null } }, { loggingComplete: true }],
      },
      orderBy: { sortAt: "desc" },
      select: recentRunSelect,
    }),
    // Today's runs in chronological order, with setup snapshot + lap summary.
    // Drives the "today's best" widget and the "changes today" feed (per-run
    // diff vs. the immediately prior logged snapshot).
    prisma.run.findMany({
      where: { userId, createdAt: { gte: todayStart, lt: todayEnd } },
      orderBy: { sortAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        sessionCompletedAt: true,
        loggingCompletedAt: true,
        sortAt: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        sessionLabel: true,
        bestLapSeconds: true,
        avgTop5LapSeconds: true,
        lapTimes: true,
        lapSession: true,
        loggingComplete: true,
        car: { select: { id: true, name: true } },
        track: { select: { id: true, name: true } },
        event: { select: { id: true, name: true } },
        setupSnapshot: { select: { id: true, data: true } },
      },
    }),
    // Last run _before_ today so the first today row's changes are diffed
    // against yesterday's final snapshot instead of appearing as a full
    // "everything changed" blob.
    prisma.run.findFirst({
      where: { userId, createdAt: { lt: todayStart } },
      orderBy: { sortAt: "desc" },
      select: { setupSnapshot: { select: { id: true, data: true } } },
    }),
    prisma.run.findMany({
      where: { userId, loggingComplete: false, incompleteLoggingPromptDismissedAt: null },
      orderBy: { sortAt: "desc" },
      take: 5,
      select: incompleteRunSelect,
    }),
    // All completed runs. Kept lean: lap arrays (lap count + wheel time + race
    // pace), stored best lap + avg-top-5, and the track+class comparability key.
    // Feeds the rolling summary and the all-time records board.
    prisma.run.findMany({
      where: {
        userId,
        OR: [{ loggingCompletedAt: { not: null } }, { loggingComplete: true }],
      },
      orderBy: { sortAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        sessionCompletedAt: true,
        loggingCompletedAt: true,
        sortAt: true,
        lapTimes: true,
        lapSession: true,
        bestLapSeconds: true,
        avgTop5LapSeconds: true,
        raceClass: true,
        trackId: true,
        track: { select: { name: true } },
      },
    }),
  ]);
  const hasRunToday = todaysRuns.length > 0;

  const summaryInputs: SummaryRunInput[] = completedRunRows.map((r) => {
    const included = getIncludedLaps(primaryLapRowsFromRun(r));
    const drivingSeconds = included.reduce((sum, l) => sum + l.lapTimeSeconds, 0);
    const storedBest = typeof r.bestLapSeconds === "number" ? r.bestLapSeconds : null;
    const bestLapSeconds =
      storedBest ?? (included.length ? Math.min(...included.map((l) => l.lapTimeSeconds)) : null);
    return {
      effectiveAt: resolveRunDisplayInstant({
        createdAt: r.createdAt,
        sessionCompletedAt: r.sessionCompletedAt,
        loggingCompletedAt: r.loggingCompletedAt,
        sortAt: r.sortAt,
      }),
      lapCount: included.length,
      drivingSeconds,
      bestLapSeconds,
      trackId: r.trackId,
      trackName: r.track?.name ?? null,
      className: r.raceClass,
    };
  });
  const summary = computeDashboardSummary(summaryInputs, new Date(), timeZone);

  // All-time records board (best lap / avg-top-5 / race pace per track+class) +
  // the fresh-PB flag when the most recent completed run just broke a record.
  const recordInputs: RecordRunInput[] = completedRunRows.map((r) => ({
    runId: r.id,
    effectiveAt: resolveRunDisplayInstant({
      createdAt: r.createdAt,
      sessionCompletedAt: r.sessionCompletedAt,
      loggingCompletedAt: r.loggingCompletedAt,
      sortAt: r.sortAt,
    }),
    trackId: r.trackId,
    trackName: r.track?.name ?? null,
    className: r.raceClass,
    bestLapSeconds: typeof r.bestLapSeconds === "number" ? r.bestLapSeconds : null,
    avgTop5Seconds: typeof r.avgTop5LapSeconds === "number" ? r.avgTop5LapSeconds : null,
    lapTimes: r.lapTimes,
    lapSession: r.lapSession,
  }));
  const { records, newPb } = computeDashboardRecords(recordInputs, recentRun?.id ?? null);

  const actionItemSelect = {
    id: true,
    text: true,
    sourceType: true,
    createdAt: true,
    sourceRunId: true,
  } as const;
  let thingsToTryRows: Array<{
    id: string;
    createdAt: Date;
    text: string;
    sourceType: ActionItemSourceType;
    sourceRunId: string | null;
  }> = [];
  let thingsToDoRows: typeof thingsToTryRows = [];
  try {
    [thingsToTryRows, thingsToDoRows] = await Promise.all([
      prisma.actionItem.findMany({
        where: { userId, isArchived: false, listKind: "THINGS_TO_TRY" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 120,
        select: actionItemSelect,
      }),
      prisma.actionItem.findMany({
        where: { userId, isArchived: false, listKind: "THINGS_TO_DO" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 120,
        select: actionItemSelect,
      }),
    ]);
  } catch {
    thingsToTryRows = [];
    thingsToDoRows = [];
  }

  const featuredPick = pickFeaturedEvent(
    scopedEvents.map((event) => ({
      id: event.id,
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      runCount: event.runCount,
    })),
    timeZone
  );

  // Most recent completed session day at a given track — the "what you ran there
  // last time" line on the event-prep card and the digest's previous-visit delta.
  const latestVisitAtTrack = (
    trackId: string,
    beforeYmd: string | null
  ): { date: Date; ymd: string; bestLap: number | null; runCount: number } | null => {
    let visit: { date: Date; ymd: string; bestLap: number | null; runCount: number } | null = null;
    for (let i = summaryInputs.length - 1; i >= 0; i--) {
      const r = summaryInputs[i];
      if (r.trackId !== trackId) continue;
      const ymd = calendarYmdInTimeZone(r.effectiveAt, timeZone);
      if (beforeYmd && ymd >= beforeYmd) continue;
      if (!visit) {
        visit = { date: r.effectiveAt, ymd, bestLap: null, runCount: 0 };
      } else if (ymd !== visit.ymd) {
        break;
      }
      visit.runCount += 1;
      if (r.bestLapSeconds != null && (visit.bestLap == null || r.bestLapSeconds < visit.bestLap)) {
        visit.bestLap = r.bestLapSeconds;
      }
    }
    return visit;
  };

  let featuredBlock: DashboardHomeModel["featuredEvent"] = null;
  if (featuredPick) {
    const featuredEvent = scopedEvents.find((event) => event.id === featuredPick.id);
    if (featuredEvent) {
      const runCount = featuredEvent.runCount;
      const latestRun =
        runCount > 0
          ? await prisma.run.findFirst({
              where: { userId, eventId: featuredEvent.id },
              orderBy: { sortAt: "desc" },
              select: {
                lapTimes: true,
                lapSession: true,
                notes: true,
                driverNotes: true,
                handlingProblems: true,
              },
            })
          : null;

      const trackLabel = resolveEventTrackLabel(featuredEvent);

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

      // Days until the event starts (calendar days in the user's zone) — the
      // off-day prep card's countdown. Only meaningful for an upcoming event.
      let daysUntilStart: number | null = null;
      if (featuredPick.featuredStatus === "next") {
        const todayYmd = calendarYmdInTimeZone(new Date(), timeZone);
        const startYmd = calendarYmdInTimeZone(featuredEvent.startDate, timeZone);
        const diffMs = Date.parse(startYmd) - Date.parse(todayYmd);
        daysUntilStart = Number.isFinite(diffMs) ? Math.max(0, Math.round(diffMs / 86_400_000)) : null;
      }

      const lastVisit = featuredEvent.trackId
        ? latestVisitAtTrack(featuredEvent.trackId, null)
        : null;

      featuredBlock = {
        id: featuredEvent.id,
        name: featuredEvent.name,
        trackLabel,
        status: featuredPick.featuredStatus,
        startDate: featuredEvent.startDate.toISOString(),
        endDate: featuredEvent.endDate.toISOString(),
        dateLabel: formatFeaturedEventDateLabel(featuredEvent, timeZone),
        runCount,
        daysUntilStart,
        lastVisit: lastVisit
          ? {
              dateIso: lastVisit.date.toISOString(),
              bestLap: lastVisit.bestLap,
              runCount: lastVisit.runCount,
            }
          : null,
        latest,
      };
    }
  }

  let todayBestLap: number | null = null;
  let todayBestAvgTop5: number | null = null;
  let todayBestRunId: string | null = null;
  let todayBestRunLabel: string | null = null;
  for (const r of todaysRuns) {
    let best = r.bestLapSeconds;
    let avg5 = r.avgTop5LapSeconds;
    if (best == null) {
      const m = computeIncludedLapMetricsFromRun(r);
      best = m.bestLap;
      avg5 = m.averageTop5;
    }
    if (best != null && (todayBestLap == null || best < todayBestLap)) {
      todayBestLap = best;
      todayBestAvgTop5 = avg5;
      todayBestRunId = r.id;
      todayBestRunLabel = formatRunSessionDisplay(r);
    }
  }

  const todaysChanges: DashboardHomeModel["todaysChanges"] = [];
  {
    let prevSnapshot: SetupSnapshotData | null =
      (priorRun?.setupSnapshot?.data as SetupSnapshotData | undefined) ?? null;
    for (const r of todaysRuns) {
      const cur = (r.setupSnapshot?.data as SetupSnapshotData | undefined) ?? null;
      if (!cur) continue;
      if (prevSnapshot) {
        const diffRows = buildSetupDiffRows(cur, prevSnapshot).filter((row) => row.changed);
        if (diffRows.length > 0) {
          todaysChanges.push({
            runId: r.id,
            when: resolveRunDisplayInstant({
              createdAt: r.createdAt,
              sessionCompletedAt: r.sessionCompletedAt,
              loggingCompletedAt: r.loggingCompletedAt,
              sortAt: r.sortAt,
            }).toISOString(),
            runLabel: formatRunSessionDisplay(r),
            rows: diffRows.map((row) => ({
              key: row.key,
              label: row.label,
              unit: row.unit,
              previous: row.previous,
              current: row.current,
            })),
          });
        }
      }
      prevSnapshot = cur;
    }
  }

  // Track-day pit board rows — latest run first. Delta compares each run's best
  // against the run logged immediately before it today (first-of-day has none).
  const changesByRunId = new Map(todaysChanges.map((c) => [c.runId, c.rows]));
  const todayStrip: DashboardHomeModel["todayStrip"] = [];
  {
    let prevBest: number | null = null;
    for (const r of todaysRuns) {
      const m = computeIncludedLapMetricsFromRun(r);
      const best = typeof r.bestLapSeconds === "number" ? r.bestLapSeconds : m.bestLap;
      const avg5 = typeof r.avgTop5LapSeconds === "number" ? r.avgTop5LapSeconds : m.averageTop5;
      todayStrip.push({
        runId: r.id,
        when: resolveRunDisplayInstant({
          createdAt: r.createdAt,
          sessionCompletedAt: r.sessionCompletedAt,
          loggingCompletedAt: r.loggingCompletedAt,
          sortAt: r.sortAt,
        }).toISOString(),
        runLabel: formatRunSessionDisplay(r),
        bestLap: best,
        avgTop5: avg5,
        lapCount: m.lapCount,
        loggingComplete: r.loggingComplete === true || Boolean(r.loggingCompletedAt),
        bestDeltaVsPrev: best != null && prevBest != null ? best - prevBest : null,
        changedRows: changesByRunId.get(r.id) ?? [],
      });
      if (best != null) prevBest = best;
    }
    todayStrip.reverse();
  }
  const lastTodayRun = todaysRuns.length > 0 ? todaysRuns[todaysRuns.length - 1] : null;
  const todayContext: DashboardHomeModel["todayContext"] = lastTodayRun
    ? {
        trackName: lastTodayRun.track?.name ?? null,
        eventName: lastTodayRun.event?.name ?? null,
        carName: lastTodayRun.car?.name ?? null,
      }
    : null;

  // Off-day digest — the most recent completed session day, with the day-best
  // compared against the previous completed day at the same track.
  let lastSessionDigest: DashboardHomeModel["lastSessionDigest"] = null;
  if (summaryInputs.length > 0) {
    const lastInput = summaryInputs[summaryInputs.length - 1];
    const lastYmd = calendarYmdInTimeZone(lastInput.effectiveAt, timeZone);
    const dayRows = summaryInputs.filter(
      (r) => calendarYmdInTimeZone(r.effectiveAt, timeZone) === lastYmd
    );
    const dayBest = dayRows.reduce<number | null>(
      (acc, r) =>
        r.bestLapSeconds != null && (acc == null || r.bestLapSeconds < acc)
          ? r.bestLapSeconds
          : acc,
      null
    );
    const dayTrackId = lastInput.trackId;
    const prevVisit = dayTrackId ? latestVisitAtTrack(dayTrackId, lastYmd) : null;
    lastSessionDigest = {
      dateIso: lastInput.effectiveAt.toISOString(),
      trackName: lastInput.trackName,
      runCount: dayRows.length,
      bestLap: dayBest,
      bestDeltaVsPrevVisit:
        dayBest != null && prevVisit?.bestLap != null ? dayBest - prevVisit.bestLap : null,
      prevVisitDateIso: prevVisit ? prevVisit.date.toISOString() : null,
    };
  }

  let recent: DashboardHomeModel["recentRun"] = null;
  if (recentRun) {
    const m = computeIncludedLapMetricsFromRun(recentRun);

    // Structured handling read for the previous-run card's handling face.
    const handlingLines = formatHandlingAssessmentDetailLines(recentRun.handlingAssessmentJson);
    const parsedHandling = parseHandlingAssessmentJson(recentRun.handlingAssessmentJson);
    if (parsedHandling?.primaryFocus) {
      const focusLine = formatPrimaryFocusLine(parsedHandling.primaryFocus);
      if (focusLine) handlingLines.push(focusLine);
    }

    // Setup changes vs the run immediately before this one (setup-changes face).
    // Every run persists a snapshot, so null only means "no earlier run to diff".
    let setupChanges: NonNullable<DashboardHomeModel["recentRun"]>["setupChanges"] = null;
    const currentSnapshot = (recentRun.setupSnapshot?.data as SetupSnapshotData | undefined) ?? null;
    if (currentSnapshot) {
      const runBefore = await prisma.run.findFirst({
        where: { userId, sortAt: { lt: recentRun.sortAt } },
        orderBy: { sortAt: "desc" },
        select: { setupSnapshot: { select: { data: true } } },
      });
      const previousSnapshot =
        (runBefore?.setupSnapshot?.data as SetupSnapshotData | undefined) ?? null;
      if (previousSnapshot) {
        setupChanges = buildSetupDiffRows(currentSnapshot, previousSnapshot)
          .filter((row) => row.changed)
          .map((row) => ({
            key: row.key,
            label: row.label,
            unit: row.unit,
            previous: row.previous,
            current: row.current,
          }));
      }
    }

    recent = {
      id: recentRun.id,
      carId: recentRun.car?.id ?? null,
      createdAt: recentRun.createdAt.toISOString(),
      sessionCompletedAt: recentRun.sessionCompletedAt
        ? recentRun.sessionCompletedAt.toISOString()
        : null,
      loggingCompletedAt: recentRun.loggingCompletedAt
        ? recentRun.loggingCompletedAt.toISOString()
        : null,
      loggingComplete: recentRun.loggingComplete,
      carName: recentRun.car?.name ?? "—",
      trackName: recentRun.track?.name ?? null,
      eventName: recentRun.event?.name ?? null,
      sessionLabel: formatRunSessionDisplay(recentRun),
      bestLap: m.bestLap,
      avgTop5: m.averageTop5,
      lapCount: m.lapCount,
      carRating: recentRun.carRating ?? null,
      handlingLines,
      handlingProblems: recentRun.handlingProblems?.trim() || null,
      setupChanges,
    };
  }

  const incompleteRuns: DashboardIncompleteRunRow[] = incompleteRunsRows.map(toDashboardIncompleteRunRow);

  const runLoggingComplete = Boolean(recent?.loggingCompletedAt) || recent?.loggingComplete === true;
  const engineerSuggestionsPrimaryRunId =
    recent?.carId && runLoggingComplete ? recent.id : null;

  return {
    incompleteRuns,
    thingsToTry: thingsToTryRows.map((i) => ({
      id: i.id,
      text: i.text,
      sourceType: i.sourceType,
      createdAt: i.createdAt.toISOString(),
      sourceRunId: i.sourceRunId,
    })),
    thingsToDo: thingsToDoRows.map((i) => ({
      id: i.id,
      text: i.text,
      sourceType: i.sourceType,
      createdAt: i.createdAt.toISOString(),
      sourceRunId: i.sourceRunId,
    })),
    featuredEvent: featuredBlock,
    hasRunToday,
    todayBestLap,
    todayBestAvgTop5,
    todayBestRunId,
    todayBestRunLabel,
    todayRunCount: todaysRuns.length,
    todayDraftRunId:
      [...todaysRuns]
        .reverse()
        .find((r) => r.loggingComplete === false)?.id ?? null,
    todayDraftSavedAt:
      [...todaysRuns]
        .reverse()
        .find((r) => r.loggingComplete === false)?.createdAt.toISOString() ?? null,
    todaysChanges,
    todayStrip,
    todayContext,
    lastSessionDigest,
    recentRun: recent,
    summary,
    records,
    newPb,
    engineerSuggestionsInitial: null,
    engineerSuggestionsPrimaryRunId,
  };
  });
}
