import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime, formatRunDateOnly } from "@/lib/formatDate";
import { perfSpan } from "@/lib/perfLog";
import {
  bestDeltaVsPreviousSameCarTrack,
  collectCarOptions,
  computeAnalysisRunMetrics,
  computeSetupChangesByRunId,
  isTrackCarPersonalBest,
  resolveTrendScope,
  runMatchesScope,
  runRowTitle,
  shortRunLabel,
  type AnalysisHomeModel,
  type AnalysisRecentRun,
  type AnalysisTrendModel,
  type AnalysisTrendRun,
  type AnalysisVideoModel,
} from "@/lib/analysis/analysisHomeModel";
import { computeTireIndicatorsByRunId } from "@/lib/runs/tireSetChange";

/** Runs fetched for the recent-runs card; extras beyond 4 feed the delta-vs-previous lookback. */
const RECENT_RUNS_LOOKBACK = 12;
const RECENT_RUNS_SHOWN = 4;
/** Cap for one event/day of runs on the trend chart. */
const TREND_SCOPE_TAKE = 80;
/** Day-scope query window around the latest run; exact match is by calendar day in `timeZone`. */
const DAY_SCOPE_WINDOW_MS = 36 * 60 * 60 * 1000;

const analysisRunSelect = {
  id: true,
  createdAt: true,
  eventId: true,
  carId: true,
  trackId: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carNameSnapshot: true,
  car: { select: { name: true } },
  tireRunNumber: true,
  tireSet: { select: { id: true, label: true, mark: true } },
  event: { select: { name: true } },
  lapTimes: true,
  lapSession: true,
  bestLapSeconds: true,
  avgTop5LapSeconds: true,
  setupSnapshot: { select: { data: true } },
} satisfies Prisma.RunSelect;

type AnalysisRunRow = Prisma.RunGetPayload<{ select: typeof analysisRunSelect }>;

function carNameOf(run: AnalysisRunRow): string {
  return run.car?.name ?? run.carNameSnapshot ?? "Unknown car";
}

const VIDEO_STATUS_LABELS: Record<string, string> = {
  PENDING: "Queued",
  RUNNING: "Processing",
  COMPLETED: "Analyzed",
  FAILED: "Failed",
};

async function loadTrendModel(
  userId: string,
  latest: { eventId: string | null; createdAt: Date; carId: string | null },
  timeZone: string
): Promise<AnalysisTrendModel | null> {
  const scope = resolveTrendScope(latest, timeZone);

  const where: Prisma.RunWhereInput =
    scope.kind === "event"
      ? { userId, eventId: scope.eventId }
      : {
          userId,
          createdAt: {
            gte: new Date(latest.createdAt.getTime() - DAY_SCOPE_WINDOW_MS),
            lte: new Date(latest.createdAt.getTime() + DAY_SCOPE_WINDOW_MS),
          },
        };

  const rows = await perfSpan("analysisTrendRuns", () =>
    prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: TREND_SCOPE_TAKE,
      select: analysisRunSelect,
    })
  );

  // Computed on the full (unfiltered) newest-first window so the first scoped
  // run still compares against the run before it where possible.
  const tireIndicatorsByRunId = computeTireIndicatorsByRunId(rows);
  const setupChangesByRunId = computeSetupChangesByRunId(
    rows.map((run) => ({
      id: run.id,
      carId: run.carId,
      setupData: run.setupSnapshot?.data ?? null,
    }))
  );

  const scoped = rows
    .filter((run) => runMatchesScope(run, scope, timeZone))
    .reverse(); // chronological

  // Chart points need laps; fallback R{n} labels count per car so switching
  // cars still reads R1..Rn.
  const perCarIndex = new Map<string, number>();
  const trendRuns: AnalysisTrendRun[] = [];
  for (const run of scoped) {
    const metrics = computeAnalysisRunMetrics(run);
    if (metrics.best == null) continue;
    const carKey = run.carId ?? "__none__";
    const index = perCarIndex.get(carKey) ?? 0;
    perCarIndex.set(carKey, index + 1);
    trendRuns.push({
      id: run.id,
      carId: run.carId,
      carName: carNameOf(run),
      shortLabel: shortRunLabel(run, index),
      createdAtIso: run.createdAt.toISOString(),
      metrics,
      tireIndicator: tireIndicatorsByRunId.get(run.id) ?? null,
      setupChange: setupChangesByRunId.get(run.id) ?? null,
    });
  }

  if (trendRuns.length === 0) return null;

  const carOptions = collectCarOptions(trendRuns);
  const defaultCarId =
    carOptions.find((option) => option.carId === latest.carId)?.carId ?? carOptions[0].carId;

  return {
    scopeKind: scope.kind,
    scopeLabel:
      scope.kind === "event"
        ? scoped[scoped.length - 1]?.event?.name ?? "This event"
        : formatRunDateOnly(latest.createdAt, timeZone),
    runs: trendRuns,
    carOptions,
    defaultCarId,
  };
}

async function loadRecentRuns(userId: string, timeZone: string): Promise<AnalysisRecentRun[]> {
  const rows = await perfSpan("analysisRecentRuns", () =>
    prisma.run.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_RUNS_LOOKBACK,
      select: analysisRunSelect,
    })
  );
  if (rows.length === 0) return [];

  const withMetrics = rows.map((run) => ({ run, metrics: computeAnalysisRunMetrics(run) }));
  // Same lookback window as the delta-vs-previous math; a swap older than the
  // window simply isn't flagged as changed.
  const tireIndicatorsByRunId = computeTireIndicatorsByRunId(rows);
  const deltaRows = withMetrics.map(({ run, metrics }) => ({
    carId: run.carId,
    trackId: run.trackId,
    best: metrics.best,
  }));

  const shown = withMetrics.slice(0, RECENT_RUNS_SHOWN);

  // Track+car personal bests via the materialized bestLapSeconds column (legacy
  // rows with a null column are invisible to the min — PB chip only, acceptable).
  const pbPairs = new Map<string, { carId: string; trackId: string }>();
  for (const { run } of shown) {
    if (run.carId && run.trackId) {
      pbPairs.set(`${run.carId}:${run.trackId}`, { carId: run.carId, trackId: run.trackId });
    }
  }
  const pbMins = new Map<string, number | null>();
  if (pbPairs.size > 0) {
    // One grouped query for all shown car+track pairs instead of one aggregate
    // round trip per pair (was N+1 on the Analysis hot path).
    const grouped = await prisma.run.groupBy({
      by: ["carId", "trackId"],
      where: {
        userId,
        OR: [...pbPairs.values()].map((p) => ({ carId: p.carId, trackId: p.trackId })),
      },
      _min: { bestLapSeconds: true },
    });
    for (const g of grouped) {
      if (g.carId && g.trackId) {
        pbMins.set(`${g.carId}:${g.trackId}`, g._min.bestLapSeconds ?? null);
      }
    }
  }

  return shown.map(({ run, metrics }, index) => {
    const pbKey = run.carId && run.trackId ? `${run.carId}:${run.trackId}` : null;
    const lapsPart =
      metrics.cleanLapCount > 0
        ? ` · ${metrics.cleanLapCount} clean lap${metrics.cleanLapCount === 1 ? "" : "s"}`
        : "";
    return {
      id: run.id,
      carId: run.carId,
      title: runRowTitle({ ...run, carName: carNameOf(run) }),
      subLabel: `${formatRunCreatedAtDateTime(run.createdAt, timeZone)}${lapsPart}`,
      metrics,
      bestDeltaVsPrev: bestDeltaVsPreviousSameCarTrack(deltaRows, index),
      isTrackCarPb: isTrackCarPersonalBest(
        metrics.best,
        pbKey ? pbMins.get(pbKey) ?? null : null
      ),
      tireIndicator: tireIndicatorsByRunId.get(run.id) ?? null,
    };
  });
}

async function loadVideoModel(userId: string, timeZone: string): Promise<AnalysisVideoModel> {
  const job = await perfSpan("analysisLatestVideoJob", () =>
    prisma.videoAnalysisJob.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        track: { select: { name: true } },
      },
    })
  );
  if (!job) return { kind: "none" };
  return {
    kind: "job",
    jobId: job.id,
    title: job.track.name,
    subLabel: `${VIDEO_STATUS_LABELS[job.status] ?? job.status} · ${formatRunDateOnly(
      job.createdAt,
      timeZone
    )}`,
  };
}

/**
 * Server model for the `/analysis` debrief page: trend chart scope (active
 * event, else the latest run's day), the last four runs, and the latest video
 * analysis job.
 */
export async function loadAnalysisHomeModel(
  userId: string,
  timeZone: string
): Promise<AnalysisHomeModel> {
  const latest = await prisma.run.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { eventId: true, createdAt: true, carId: true },
  });

  const [trend, recentRuns, video] = await Promise.all([
    latest ? loadTrendModel(userId, latest, timeZone) : Promise.resolve(null),
    loadRecentRuns(userId, timeZone),
    loadVideoModel(userId, timeZone),
  ]);

  return { trend, recentRuns, video };
}
