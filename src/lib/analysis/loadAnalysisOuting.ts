import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { perfSpan } from "@/lib/perfLog";
import { calendarYmdInTimeZone, formatRunDateOnly } from "@/lib/formatDate";
import {
  buildGroupRunRows,
  buildGroupTrendModel,
  type WorkbenchRunRow,
} from "@/lib/runs/sessionWorkbenchModel";
import type { AnalysisTrendModel } from "@/lib/analysis/analysisHomeModel";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { resolveOutingHeading } from "@/lib/runs/outingHeading";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";

/**
 * Your last time at the track — the block `/analysis` is built around (2026-08-25).
 *
 * ## One DAY, never a whole event
 *
 * The trend chart on this page used to scope itself to the most recent *event* when
 * the latest run belonged to one, which on a three-day title meeting meant unfolding
 * Friday, Saturday and Sunday into a single list of twenty runs. Founder call: don't
 * unfold the whole event. The block is the most recent **calendar day**, in the zone
 * the run was logged in, and the event only lends the block its NAME.
 *
 * That also makes the chart and the list underneath it the same runs, which is the
 * point of the page: a dot and a row are the same thing.
 *
 * ## Why it fetches whole run records
 *
 * The rows open in place into `RunFaces`, which is the run page folded — so it needs
 * everything the run page needs. This select is therefore the same shape as the
 * Sessions one; anything `RunFaces` reads must be listed here or it is a runtime hole
 * that only the prop types catch.
 */

/** A day's runs, with headroom: a 24-run club day is normal, 60 is not. */
const OUTING_TAKE = 60;
/** Query window around the latest run; the exact day match happens in JS, per zone. */
const DAY_WINDOW_MS = 36 * 60 * 60 * 1000;

export const analysisOutingSelect = {
  id: true,
  userId: true,
  createdAt: true,
  sortAt: true,
  localTimeZone: true,
  sessionCompletedAt: true,
  loggingComplete: true,
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
  /** Newest-first, exactly as the Sessions day view lists them. */
  rows: WorkbenchRunRow[];
  /** Full records keyed by id, for the row that opens. */
  runs: AnalysisOutingRun[];
  /** Offered to the open run's lap-compare picker: the rest of the same day. */
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

  const ymd = calendarYmdInTimeZone(latest.createdAt, zoneOf(latest, accountZone, viewerTimeZone));

  const window = await perfSpan("analysisOutingRuns", () =>
    prisma.run.findMany({
      where: {
        userId,
        createdAt: {
          gte: new Date(latest.createdAt.getTime() - DAY_WINDOW_MS),
          lte: new Date(latest.createdAt.getTime() + DAY_WINDOW_MS),
        },
      },
      orderBy: { createdAt: "desc" },
      take: OUTING_TAKE,
      select: analysisOutingSelect,
    })
  );

  // The window is generous on purpose — a run logged at 11pm and one at 1am are a
  // day apart by the clock and often the same outing by the driver's reckoning, so
  // the exact match is done here, per run, in the zone that run was logged in.
  const runs = window.filter(
    (run) => calendarYmdInTimeZone(run.createdAt, zoneOf(run, accountZone, viewerTimeZone)) === ymd
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
  const dateLabel = formatRunDateOnly(runs[0].createdAt, dayZone);
  const trackName = runs[0].track?.name ?? runs[0].trackNameSnapshot ?? null;
  // An event names the day; it does not widen it. A meeting that ran three days
  // still shows one of them here — see the file note.
  const eventName = runs.find((r) => r.event?.name?.trim())?.event?.name?.trim() ?? null;

  const group = {
    title: eventName ?? "Test day",
    type: (eventName ? "Event" : "Testing") as "Event" | "Testing",
    trackName,
    dateLabel,
    runs,
  };
  // The row builders resolve each run's clock through this — see `zoneOf` for what
  // the account entry fixes.
  const zones = { ownerTimeZoneByUserId: { [userId]: accountZone }, viewerTimeZone };

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
