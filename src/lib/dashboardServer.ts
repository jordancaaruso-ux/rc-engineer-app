import type { ActionItemSourceType } from "@prisma/client";

/**
 * Action-item row as it comes back from Prisma (`createdAt` still a Date). Distinct from
 * the exported `DashboardActionItemRow` below, which is the serialized client shape.
 */
type ActionItemDbRow = {
  id: string;
  createdAt: Date;
  text: string;
  sourceType: ActionItemSourceType;
  sourceRunId: string | null;
};
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
import { pickFeaturedEvent, todayBoundsInTimeZone } from "@/lib/eventActive";
import { calendarYmdInTimeZone, formatFeaturedEventDateLabel, RUN_DATETIME_LOCALE } from "@/lib/formatDate";
// NOTE: `syncRecentEventLapSources` is deliberately NOT imported at module scope —
// see the dynamic import at its call site below.
import { loadUserScopedEvents, userCanAccessEvent } from "@/lib/events/eventParticipation";
import { resolveEventTrackLabel } from "@/lib/tracks/legacyTrackSnapshot";
import { getLiveRcDriverIdSetting, getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import { isRunContextSetupKey } from "@/lib/setup/runContextSetupKeys";
import type { SetupSnapshotData } from "@/lib/runSetup";
import {
  computeTodayVerdict,
  consistencyDialValue,
  consistencyPercent,
  consistencyWord,
  type ConsistencyWord,
  type TodayVerdict,
  type VerdictRunInput,
} from "@/lib/dashboardVerdict";
import { pickHeroSeries } from "@/lib/dashboardHeroSeries";
import { perfSpan } from "@/lib/perfLog";

export type { DashboardNewRunPrefill, DashboardSerializedRun } from "@/lib/dashboardPrefillTypes";
export type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";

/** @deprecated import from `@/lib/eventActive` */
export { eventIsActiveOnLocalToday, eventIsActiveOnCalendarDay } from "@/lib/eventActive";

// "Today" bounds are computed in the USER's timezone (rc_tz cookie), never the
// server's — Vercel runs in UTC, so server-local midnight is 10am for an AEST
// user and every today-scoped surface (draft CTA, Today strip, hasRunToday)
// would roll over mid-morning. See `todayBoundsInTimeZone`.

const runPrefillInclude = (userId: string) =>
  ({
  track: { select: { id: true, name: true } },
  trackLayout: { select: { id: true, name: true } },
  car: { select: { id: true, name: true } },
  tireType: { select: { id: true, displayName: true, modelCode: true } },
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
    tireTypeId: string | null;
    tireType: { id: string; displayName: string; modelCode: string } | null;
    tireRunNumber: number;
    tireStintId: string | null;
    tireAgeKnown: boolean;
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
    tireTypeId: run.tireTypeId,
    tireType: run.tireType,
    tireRunNumber: run.tireRunNumber,
    tireStintId: run.tireStintId,
    tireAgeKnown: run.tireAgeKnown,
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
    /** Which day of the meeting today is (1-based) and how many days it runs; null unless status is "active". */
    dayOfMeeting: number | null;
    totalDays: number | null;
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
    /** Clock time the run was logged, in the user's timezone (e.g. "2:41 pm"). */
    timeLabel: string;
    runLabel: string;
    bestLap: number | null;
    avgTop5: number | null;
    lapCount: number;
    /**
     * 1–10 handling rating, null when the run was not rated. On a day with no lap times
     * this is the only figure that moved, so the desktop's no-laps card leans on it.
     */
    carRating: number | null;
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
   * Track-day computed verdict — pace trend / last-change effect / consistency
   * (docs/DASHBOARD_NORTH_STAR.md v2, 2026-07-19). Pure math, no AI.
   */
  todayVerdict: TodayVerdict | null;
  /**
   * Desktop hero readout (design handoff 2026-08-08) — the big lap numeral, the two
   * rating dials and the pace chart. Track day plots today's runs; an off day plots
   * earlier sessions AT THE SAME TRACK.
   *
   * The same-track scope is the whole point of the off-day series (founder call
   * 2026-08-10). Plotting the last eight runs in date order regardless of venue put a
   * 12-second club track and an 18-second big track on one axis, so most of the line's
   * movement was a change of car park, and `foundSeconds` measured the gap between two
   * circuits. Anything that scopes this series must stay single-track.
   *
   * Costs no extra query: `completedRunRows` (the full history behind the 30-day summary
   * and the records board) already carries best lap, laps and track per run. Null when
   * the account has nothing to plot yet.
   */
  heroPace: null | {
    bestLap: number | null;
    avgTop5: number | null;
    /** 1–10 handling rating behind the first dial; null when the run was not rated. */
    carRating: number | null;
    /** Signed delta of the last series point vs the one before it; negative is faster. */
    deltaSeconds: number | null;
    consistency: null | {
      word: ConsistencyWord;
      spreadSeconds: number;
      /** 0–10 magnitude for the dial's arc. The dial prints `percent`, never this. */
      value: number;
      /** 100 minus the spread's share of lap time — the number inside the ring. */
      percent: number | null;
    };
    /**
     * What the series counts. `sessions` = one point per run; `laps` = one point per lap
     * within the anchor run, the fallback when the anchor track has no earlier session to
     * compare against (a first visit). The two are different quantities on the same axis,
     * so every label built from this series has to branch on it.
     */
    seriesKind: "sessions" | "laps";
    /** The track the series is scoped to; null when the anchor run has no track. */
    trackName: string | null;
    /** The anchor run's date, formatted in the user's zone — the meta line's last field. */
    anchorLabel: string | null;
    /** Oldest first — the chart reads left to right. */
    series: Array<{ runId: string; label: string; best: number }>;
    /**
     * Total time found across the series; positive = quicker now than at the start.
     * Null for a lap series: first lap vs last lap inside one run is not progress.
     */
    foundSeconds: number | null;
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
    sessionLabel: formatRunSessionDisplay(
      {
        sessionType: r.sessionType,
        meetingSessionType: r.meetingSessionType,
        meetingSessionCode: r.meetingSessionCode,
        sessionLabel: r.sessionLabel,
      },
      // Draft choosers list runs from arbitrary days — no day ordinal to hand
      // out, so an unlabeled testing run reads "Run" rather than "—".
      { fallback: "Run" }
    ),
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
  userId: string,
  timeZone: string
): Promise<DashboardIncompleteRunRow[]> {
  const { start, end } = todayBoundsInTimeZone(timeZone);
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
  const { start: todayStart, end: todayEnd } = todayBoundsInTimeZone(timeZone);
  // One completed-runs fetch feeds BOTH the rolling 30-day summary (it ignores
  // rows outside its window) AND the all-time records board (which genuinely
  // needs every run — a PB is forever). At current scale this is fine; if it
  // gets heavy, materialize a per-run race-pace column + a records rollup.

  // Fire-and-forget: LiveRC fetches + Prisma writes; can take 1–2s. Dashboard no
  // longer shows detected-session prompts, but background sync keeps event lap
  // sources fresh for next features / pages.
  /*
   * Imported lazily, not at module scope.
   *
   * This pulls the LiveRC scraping stack — cheerio, the parser registry, the HTML
   * extractors — which measured at 42 of the 147 modules on the dashboard's server
   * path, roughly a third of it, plus cheerio's own dependency tree. Every cold lambda
   * was parsing an HTML scraper before it could render the dashboard, and cold requests
   * measured p50 270ms / p95 5.2s against 27ms / 376ms warm.
   *
   * Nothing here is awaited — it is background freshness for lap sources — so deferring
   * the import costs the response nothing and takes the whole subtree off the boot path.
   */
  void (async () => {
    const { syncRecentEventLapSources } = await import(
      "@/lib/eventLapDetection/syncEventLapSources"
    );
    await syncRecentEventLapSources(userId);
  })().catch(() => {});

  const actionItemSelect = {
    id: true,
    text: true,
    sourceType: true,
    createdAt: true,
    sourceRunId: true,
  } as const;

  /*
   * Action items depend on nothing but `userId`, so they ride in the wave below instead
   * of costing their own round trip after it — a round trip is ~16ms whatever the query.
   * The `catch` keeps the original behaviour: if either list fails, the dashboard renders
   * with both empty rather than erroring.
   */
  const actionItemRowsPromise: Promise<[ActionItemDbRow[], ActionItemDbRow[]]> =
    Promise.all([
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
    ]).catch(() => [[], []] as [ActionItemDbRow[], ActionItemDbRow[]]);

  const [
    scopedEvents,
    recentRun,
    todaysRuns,
    priorRuns,
    incompleteRunsRows,
    completedRunRows,
    [thingsToTryRows, thingsToDoRows],
  ] = await Promise.all([
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
        // Feeds the desktop hero's handling dial for the day's latest run. A column on
        // a query that already runs, not a new read.
        carRating: true,
        car: { select: { id: true, name: true } },
        track: { select: { id: true, name: true } },
        event: { select: { id: true, name: true } },
        setupSnapshot: { select: { id: true, data: true } },
      },
    }),
    // Runs _before_ today, newest first, so the first today row's changes are diffed
    // against that car's last snapshot instead of appearing as a full "everything
    // changed" blob.
    //
    // A handful of rows rather than one, because the baseline has to be the same CAR
    // (fixed 2026-08-11). Diffing an X4 against yesterday's MTC3 turned one setup change
    // into 101 of them, most reading "-2 → —" because the other car's sheet simply has
    // no such field. A day spent on the second car in the garage is ordinary, so the
    // window covers a few runs back rather than only the very last one.
    prisma.run.findMany({
      where: { userId, createdAt: { lt: todayStart } },
      orderBy: { sortAt: "desc" },
      take: 12,
      select: { carId: true, setupSnapshot: { select: { id: true, data: true } } },
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
    actionItemRowsPromise,
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
      // Where today sits inside a meeting that's already running ("Day 2 of 3").
      // Only meaningful while it's active; both stay null otherwise.
      let dayOfMeeting: number | null = null;
      let totalDays: number | null = null;
      if (featuredPick.featuredStatus === "next" || featuredPick.featuredStatus === "active") {
        const todayYmd = calendarYmdInTimeZone(new Date(), timeZone);
        const startYmd = calendarYmdInTimeZone(featuredEvent.startDate, timeZone);
        const endYmd = calendarYmdInTimeZone(featuredEvent.endDate, timeZone);
        const daysBetween = (fromYmd: string, toYmd: string): number | null => {
          const diffMs = Date.parse(toYmd) - Date.parse(fromYmd);
          return Number.isFinite(diffMs) ? Math.round(diffMs / 86_400_000) : null;
        };

        if (featuredPick.featuredStatus === "next") {
          const diff = daysBetween(todayYmd, startYmd);
          daysUntilStart = diff == null ? null : Math.max(0, diff);
        } else {
          const elapsed = daysBetween(startYmd, todayYmd);
          const span = daysBetween(startYmd, endYmd);
          totalDays = span == null ? null : Math.max(1, span + 1);
          dayOfMeeting =
            elapsed == null
              ? null
              : Math.min(totalDays ?? Number.MAX_SAFE_INTEGER, Math.max(1, elapsed + 1));
        }
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
        dayOfMeeting,
        totalDays,
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

  // Unlabeled testing runs get their position in today's chronological order as
  // their name ("Run 2") instead of the bare "—" fallback.
  const dayRunNumberByRunId = new Map(todaysRuns.map((r, i) => [r.id, i + 1]));
  const todayRunLabel = (r: (typeof todaysRuns)[number]) =>
    formatRunSessionDisplay(r, { dayRunNumber: dayRunNumberByRunId.get(r.id) });

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
      todayBestRunLabel = todayRunLabel(r);
    }
  }

  const todaysChanges: DashboardHomeModel["todaysChanges"] = [];
  {
    /**
     * Yesterday's snapshot for one car. Null when that car has no run in the window —
     * its first outing has nothing to have changed FROM, and a diff against another
     * car's sheet is noise, not history.
     */
    const priorSnapshotForCar = (carId: string | null | undefined) =>
      (priorRuns.find((p) => p.carId != null && p.carId === carId)?.setupSnapshot?.data as
        | SetupSnapshotData
        | undefined) ?? null;

    let prevSnapshot: SetupSnapshotData | null = priorSnapshotForCar(todaysRuns[0]?.car?.id);
    let prevCarId: string | null | undefined = todaysRuns[0]?.car?.id;
    for (const r of todaysRuns) {
      const cur = (r.setupSnapshot?.data as SetupSnapshotData | undefined) ?? null;
      if (!cur) continue;
      // Swapping cars mid-day restarts the trail on that car's own last snapshot.
      if (r.car?.id !== prevCarId) {
        prevSnapshot = priorSnapshotForCar(r.car?.id);
        prevCarId = r.car?.id;
      }
      if (prevSnapshot) {
        const diffRows = buildSetupDiffRows(cur, prevSnapshot).filter(
          // Tires, additive and prep are picked on the run's Tires tab and mirrored into
          // the sheet; RUN_CONTEXT_SETUP_KEYS says no "what changed" list may count them.
          (row) => row.changed && !isRunContextSetupKey(row.key),
        );
        if (diffRows.length > 0) {
          todaysChanges.push({
            runId: r.id,
            when: resolveRunDisplayInstant({
              createdAt: r.createdAt,
              sessionCompletedAt: r.sessionCompletedAt,
              loggingCompletedAt: r.loggingCompletedAt,
              sortAt: r.sortAt,
            }).toISOString(),
            runLabel: todayRunLabel(r),
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
  const stripTimeFormat = new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  });
  const todayStrip: DashboardHomeModel["todayStrip"] = [];
  const verdictInputs: VerdictRunInput[] = [];
  {
    let prevBest: number | null = null;
    for (const r of todaysRuns) {
      const m = computeIncludedLapMetricsFromRun(r);
      const best = typeof r.bestLapSeconds === "number" ? r.bestLapSeconds : m.bestLap;
      const avg5 = typeof r.avgTop5LapSeconds === "number" ? r.avgTop5LapSeconds : m.averageTop5;
      const instant = resolveRunDisplayInstant({
        createdAt: r.createdAt,
        sessionCompletedAt: r.sessionCompletedAt,
        loggingCompletedAt: r.loggingCompletedAt,
        sortAt: r.sortAt,
      });
      const changedRows = changesByRunId.get(r.id) ?? [];
      todayStrip.push({
        runId: r.id,
        when: instant.toISOString(),
        timeLabel: stripTimeFormat.format(instant),
        runLabel: todayRunLabel(r),
        bestLap: best,
        avgTop5: avg5,
        lapCount: m.lapCount,
        carRating: r.carRating ?? null,
        loggingComplete: r.loggingComplete === true || Boolean(r.loggingCompletedAt),
        bestDeltaVsPrev: best != null && prevBest != null ? best - prevBest : null,
        changedRows,
      });
      if (best != null) prevBest = best;

      // Verdict input: spread of the run's five best laps (needs the raw laps).
      let top5SpreadSeconds: number | null = null;
      const includedLaps = getIncludedLaps(primaryLapRowsFromRun(r));
      if (includedLaps.length >= 5) {
        const top5 = includedLaps
          .map((l) => l.lapTimeSeconds)
          .sort((a, b) => a - b)
          .slice(0, 5);
        top5SpreadSeconds = top5[4] - top5[0];
      }
      verdictInputs.push({
        runLabel: todayRunLabel(r),
        bestLap: best,
        avgTop5: avg5,
        top5SpreadSeconds,
        changedRows,
      });
    }
    todayStrip.reverse();
  }
  const todayVerdict = computeTodayVerdict(verdictInputs);
  const lastTodayRun = todaysRuns.length > 0 ? todaysRuns[todaysRuns.length - 1] : null;
  const todayContext: DashboardHomeModel["todayContext"] = lastTodayRun
    ? {
        trackName: lastTodayRun.track?.name ?? null,
        eventName: lastTodayRun.event?.name ?? null,
        carName: lastTodayRun.car?.name ?? null,
      }
    : null;

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
        // Same car only — see the today-changes baseline above. Diffing this run against
        // whatever car happened to run last printed a hundred phantom changes.
        where: {
          userId,
          sortAt: { lt: recentRun.sortAt },
          ...(recentRun.car?.id ? { carId: recentRun.car.id } : {}),
        },
        orderBy: { sortAt: "desc" },
        select: { setupSnapshot: { select: { data: true } } },
      });
      const previousSnapshot =
        (runBefore?.setupSnapshot?.data as SetupSnapshotData | undefined) ?? null;
      if (previousSnapshot) {
        setupChanges = buildSetupDiffRows(currentSnapshot, previousSnapshot)
          .filter((row) => row.changed && !isRunContextSetupKey(row.key))
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

  /*
   * Desktop hero (design handoff 2026-08-08, docs/DASHBOARD_NORTH_STAR.md).
   *
   * Every value here is derived from rows already fetched above — no extra query. The
   * handoff assumed the off-day pace series would need one; it does not, because
   * `completedRunRows` is the full run history the 30-day summary and the records board
   * already read, carrying best lap, laps and track per run.
   */
  const heroSeriesFormatter = new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, {
    day: "2-digit",
    month: "short",
    timeZone,
  });

  /** Spread of a run's five best included laps — the consistency dial's input. */
  const top5SpreadOf = (run: { lapTimes: unknown; lapSession: unknown }): number | null => {
    const included = getIncludedLaps(primaryLapRowsFromRun(run as never));
    if (included.length < 5) return null;
    const top5 = included
      .map((l) => l.lapTimeSeconds)
      .sort((a, b) => a - b)
      .slice(0, 5);
    return top5[4] - top5[0];
  };

  let heroPace: DashboardHomeModel["heroPace"] = null;
  {
    /*
     * Track day plots today run-by-run. An off day plots earlier sessions at the SAME
     * TRACK as the most recent run — see the `heroPace` type for why the old
     * whatever-the-venue series had to go.
     *
     * A first visit leaves nothing to compare against, so rather than an empty box the
     * chart drops a level and plots the laps inside that one run: still a real trend,
     * just a shorter window (founder call 2026-08-10).
     */
    const offDay = hasRunToday
      ? null
      : pickHeroSeries({
          anchorRunId: recentRun?.id ?? null,
          anchorTrackId: recentRun?.track?.id ?? null,
          history: completedRunRows.map((r) => ({
            id: r.id,
            trackId: r.trackId,
            bestLapSeconds: typeof r.bestLapSeconds === "number" ? r.bestLapSeconds : null,
            label: heroSeriesFormatter.format(r.sortAt ?? r.createdAt).toUpperCase(),
          })),
          anchorLaps: recentRun ? getIncludedLaps(primaryLapRowsFromRun(recentRun as never)) : [],
        });

    const seriesKind: "sessions" | "laps" = offDay?.kind ?? "sessions";
    const series = offDay
      ? offDay.points
      : [...todayStrip]
          .reverse()
          .filter((r) => r.bestLap != null)
          .map((r) => ({ runId: r.runId, label: r.runLabel, best: r.bestLap as number }));

    const anchorRun = hasRunToday ? todaysRuns[todaysRuns.length - 1] : recentRun;
    const anchorBest = hasRunToday
      ? todayBestLap
      : recentRun
        ? computeIncludedLapMetricsFromRun(recentRun).bestLap
        : null;

    const spread = anchorRun ? top5SpreadOf(anchorRun) : null;
    const anchorRunBest =
      anchorRun && "bestLapSeconds" in anchorRun && typeof anchorRun.bestLapSeconds === "number"
        ? anchorRun.bestLapSeconds
        : anchorBest;

    if (series.length > 0 || anchorBest != null) {
      heroPace = {
        bestLap: anchorBest,
        avgTop5: hasRunToday
          ? todayBestAvgTop5
          : recentRun
            ? computeIncludedLapMetricsFromRun(recentRun).averageTop5
            : null,
        carRating: hasRunToday
          ? (todaysRuns[todaysRuns.length - 1]?.carRating ?? null)
          : (recentRun?.carRating ?? null),
        // Last point vs the one before it: the move the driver just made. A lap series has
        // no earlier session to move from, so there is no honest delta to show.
        deltaSeconds:
          seriesKind === "sessions" && series.length >= 2
            ? series[series.length - 1].best - series[series.length - 2].best
            : null,
        consistency:
          spread != null
            ? {
                word: consistencyWord(spread, anchorRunBest),
                spreadSeconds: spread,
                value: consistencyDialValue(spread, anchorRunBest),
                percent: consistencyPercent(spread, anchorRunBest),
              }
            : null,
        seriesKind,
        trackName: hasRunToday
          ? (todayContext?.trackName ?? null)
          : (recentRun?.track?.name ?? null),
        anchorLabel:
          !hasRunToday && recentRun
            ? heroSeriesFormatter.format(
                resolveRunDisplayInstant({
                  createdAt: recentRun.createdAt,
                  sessionCompletedAt: recentRun.sessionCompletedAt,
                  loggingCompletedAt: recentRun.loggingCompletedAt,
                  sortAt: recentRun.sortAt,
                })
              )
            : null,
        series,
        // Positive = quicker now than at the start of the series.
        foundSeconds:
          seriesKind === "sessions" && series.length >= 2
            ? series[0].best - series[series.length - 1].best
            : null,
      };
    }
  }

  return {
    heroPace,
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
    todayVerdict,
    recentRun: recent,
    summary,
    records,
    newPb,
  };
  });
}
