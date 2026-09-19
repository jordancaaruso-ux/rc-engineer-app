import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { perfSpan } from "@/lib/perfLog";
import {
  buildGroupRunRows,
  buildGroupTrendModel,
  type WorkbenchRunRow,
} from "@/lib/runs/sessionWorkbenchModel";
import { buildRunHistoryGroups, runSessionSortInstant } from "@/lib/runs/buildRunHistoryGroups";
import type { AnalysisTrendModel } from "@/lib/analysis/analysisHomeModel";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { resolveOutingHeading } from "@/lib/runs/outingHeading";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";

/**
 * Your last time at the track — the block `/analysis` is built around (2026-08-25).
 *
 * ## The whole meeting, cut into days (founder ruling 2026-09-14, reversing 2026-08-25)
 *
 * From 2026-08-25 this block was one calendar day — the founder had seen a three-day
 * title unfold into a single undivided list of twenty runs and ruled "don't unfold the
 * whole event". The day rule had its own failure, reported 2026-09-14: one run on the
 * Sunday of a meeting left a one-dot chart on this page *"forever, until I go to the
 * track again"*. The ruling now: **the block is the meeting, broken up into days.**
 *
 * "The meeting" is exactly what Sessions calls a session — `buildRunHistoryGroups`
 * decides it here too, so the two pages cannot disagree about which runs belong
 * together. An event holds every run under it plus the eventless runs at its track on
 * days that touch it (the Friday practice before the title — *"yes, fold it in"*). A
 * run with no event and nothing to fold into is still its own day. **Events only**: two
 * back-to-back test days with no event stay two outings, by the same ruling.
 *
 * The chart draws a band per day and the list breaks on the same key, so a dot and a
 * row are still the same thing — that part of the 2026-08-25 call stands.
 *
 * ## Why it fetches whole run records
 *
 * The rows open in place into `RunFaces`, which is the run page folded — so it needs
 * everything the run page needs. This select is therefore the same shape as the
 * Sessions one; anything `RunFaces` reads must be listed here or it is a runtime hole
 * that only the prop types catch.
 */

/**
 * A meeting's runs, with headroom: a 24-run club day is normal, a ten-day international at
 * ten runs a day is the biggest thing this block will ever be asked to hold.
 */
const OUTING_TAKE = 120;
/**
 * How far back from the newest run a meeting can reach. The fold itself walks at most
 * `MAX_EVENT_FOLD_DAYS` (14); this only bounds the candidate query, and 36h forward covers
 * a run whose clock sits after the newest `createdAt` in some zone.
 */
const LOOKBACK_MS = 16 * 24 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 36 * 60 * 60 * 1000;
/** Candidate rows are light (no laps, no setup); a season at one track fits. */
const CANDIDATE_TAKE = 400;

export const analysisOutingSelect = {
  id: true,
  userId: true,
  createdAt: true,
  sortAt: true,
  importedLapTimeSessionId: true,
  localTimeZone: true,
  sessionCompletedAt: true,
  loggingComplete: true,
  unconfirmedAt: true,
  lapImportPromptDismissedAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carId: true,
  carNameSnapshot: true,
  trackNameSnapshot: true,
  eventId: true,
  raceClass: true,
  tireRunNumber: true,
  warmerTimingMinutes: true,
  tirePrep: true,
  setupSnapshotId: true,
  lapTimes: true,
  lapSession: true,
  bestLapSeconds: true,
  avgTop5LapSeconds: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  handlingAssessmentJson: true,
  carRating: true,
  conditionsAirTempC: true,
  conditionsTrackTempC: true,
  conditionsCloudCoverPct: true,
  conditionsWeatherCode: true,
  conditionsHumidityPct: true,
  conditionsWindKph: true,
  conditionsWindDirDeg: true,
  conditionsSource: true,
  conditionsLatitude: true,
  conditionsLongitude: true,
  conditionsObservedAt: true,
  car: { select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true } },
  track: { select: { id: true, name: true } },
  tireStintId: true,
  tireAgeKnown: true,
  // The front end of a front/rear car, and what each end is glued to.
  frontTireRunNumber: true,
  frontTireStintId: true,
  frontTireAgeKnown: true,
  frontTireType: { select: { id: true, displayName: true } },
  tireFitment: true,
  tireType: { select: { id: true, displayName: true } },
  additiveType: { select: { id: true, displayName: true } },
  event: {
    select: {
      name: true,
      startDate: true,
      endDate: true,
      trackNameSnapshot: true,
      track: { select: { name: true } },
    },
  },
  setupSnapshot: { select: { id: true } },
  importedLapSets: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sourceUrl: true,
      driverId: true,
      driverName: true,
      displayName: true,
      surname: true,
      normalizedName: true,
      isPrimaryUser: true,
    },
  },
} satisfies Prisma.RunSelect;

export type AnalysisOutingRun = Prisma.RunGetPayload<{ select: typeof analysisOutingSelect }>;

export type AnalysisOutingModel = {
  /** "Round 4 · NSW Titles" when the day belongs to a meeting, else the track or "Test day". */
  title: string;
  kind: "Event" | "Testing";
  /** "Glen Innes RC Raceway · Sun 24 Aug 2026" — where and when, under the title. */
  where: string;
  /** Newest-first, exactly as the Sessions day view lists them; `dayKey` breaks the days. */
  rows: WorkbenchRunRow[];
  /** Full records keyed by id, for the row that opens. */
  runs: AnalysisOutingRun[];
  /** Offered to the open run's lap-compare picker: the rest of the same meeting. */
  pickerRuns: CompareRunShape[];
  /** The same picture the day view draws, run for run. */
  trend: AnalysisTrendModel | null;
  /**
   * The clock this outing is read on — the driver's, resolved with the account
   * fallback for runs older than `Run.localTimeZone`. Handed to the open run so its
   * "When" line cannot disagree with the row above it.
   */
  timeZone: string;
};

/**
 * The zone a run's clock is read on: the run's own, then the driver's account, then
 * the reader's.
 *
 * The middle step is not optional and was missing for one drive of this page, which
 * printed the same run as **6:48 AM** here and **4:48 PM** on Sessions. Runs logged
 * before `Run.localTimeZone` existed carry no zone of their own, so without the
 * account fallback they land on the reader's — UTC, for anything server-rendered
 * without a timezone cookie — and a Sunday afternoon reads as a Sunday morning.
 */
function zoneOf(
  run: { localTimeZone: string | null },
  accountZone: string | null,
  viewerZone: string
): string {
  return run.localTimeZone ?? accountZone ?? viewerZone;
}

export async function loadAnalysisOuting(
  userId: string,
  viewerTimeZone: string
): Promise<AnalysisOutingModel | null> {
  const [latest, account] = await Promise.all([
    perfSpan("analysisOutingLatest", () =>
      prisma.run.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, localTimeZone: true },
      })
    ),
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
  ]);
  if (!latest) return null;
  const accountZone = account?.timeZone ?? null;

  const zones = { ownerTimeZoneByUserId: { [userId]: accountZone }, viewerTimeZone };

  // Which runs are "the meeting" is decided on light rows first — the same fields and
  // the same function the Sessions list groups by — and only the members are then
  // fetched in full. Fetching every run in the window in full would drag lap JSON and
  // setup ids for a fortnight through the page to throw most of it away.
  const candidates = await perfSpan("analysisOutingCandidates", () =>
    prisma.run.findMany({
      where: {
        userId,
        createdAt: {
          gte: new Date(latest.createdAt.getTime() - LOOKBACK_MS),
          lte: new Date(latest.createdAt.getTime() + LOOKAHEAD_MS),
        },
      },
      orderBy: { createdAt: "desc" },
      take: CANDIDATE_TAKE,
      select: {
        id: true,
        userId: true,
        createdAt: true,
        sortAt: true,
        importedLapTimeSessionId: true,
        localTimeZone: true,
        eventId: true,
        trackNameSnapshot: true,
        track: { select: { name: true } },
        event: {
          select: {
            name: true,
            startDate: true,
            endDate: true,
            trackNameSnapshot: true,
            track: { select: { name: true } },
          },
        },
      },
    })
  );
  const meeting = buildRunHistoryGroups(candidates, viewerTimeZone, {
    ownerTimeZoneByUserId: zones.ownerTimeZoneByUserId,
  }).find((group) => group.runs.some((run) => run.id === latest.id));
  if (!meeting) return null;

  // Group runs are newest-first by the Sessions clock, so the cap keeps the newest.
  const memberIds = meeting.runs.slice(0, OUTING_TAKE).map((run) => run.id);
  const fetched = await perfSpan("analysisOutingRuns", () =>
    prisma.run.findMany({
      where: { id: { in: memberIds } },
      select: analysisOutingSelect,
    })
  );
  // Newest-first on the same clock Sessions lists by, not by `createdAt`: a re-imported
  // run keeps its place in the day (`sortAt`), and the chart reverses this to draw.
  const runs = [...fetched].sort(
    (a, b) => runSessionSortInstant(b).getTime() - runSessionSortInstant(a).getTime()
  );
  if (runs.length === 0) return null;

  const setupSnapshotIds = runs
    .map((r) => r.setupSnapshotId)
    .filter((id): id is string => Boolean(id));
  const snapshots = setupSnapshotIds.length
    ? await perfSpan("analysisOutingSetups", () =>
        prisma.setupSnapshot.findMany({
          where: { id: { in: setupSnapshotIds } },
          select: { id: true, data: true },
        })
      )
    : [];
  const dataBySnapshotId = new Map<string, unknown>(snapshots.map((s) => [s.id, s.data]));
  const setupDataByRunId = new Map<string, unknown>(
    runs.map((r) => [r.id, r.setupSnapshotId ? dataBySnapshotId.get(r.setupSnapshotId) : undefined])
  );

  const dayZone = zoneOf(runs[0], accountZone, viewerTimeZone);
  // The meeting names itself the way the Sessions rail does — title, venue and a date
  // RANGE when it spans days ("12 – 14 Sep 2026"). A test day's stored title is the
  // rail's own "Test day – <date>" string; `resolveOutingHeading` names it by its track.
  const trackName = meeting.trackName === "—" ? null : meeting.trackName;
  const dateLabel = meeting.dateLabel;

  const group = {
    title: meeting.type === "Event" ? meeting.title : "Test day",
    type: meeting.type,
    trackName,
    dateLabel,
    runs,
  };

  // One rule for how a day names itself, shared with the Sessions day screen so the
  // two can never disagree about the same outing. See `resolveOutingHeading`.
  const headingParts = resolveOutingHeading({
    title: group.title,
    type: group.type,
    trackName,
    dateLabel,
  });

  return {
    ...headingParts,
    timeZone: dayZone,
    rows: buildGroupRunRows(group, zones, { setupDataByRunId }),
    runs,
    pickerRuns: runs.map(toCompareRunShape),
    trend: buildGroupTrendModel(group, { setupDataByRunId, zones }),
  };
}
