import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatRunDateOnly, formatRunDateShort, formatRunTimeOnly } from "@/lib/formatDate";
import { perfSpan } from "@/lib/perfLog";
import {
  bestDeltaVsPreviousSameCarTrack,
  collectCarOptions,
  computeAnalysisRunMetrics,
  computeLapDistribution,
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
} from "@/lib/analysis/analysisHomeModel";
import { loadOutWithYou } from "@/lib/analysis/loadOutWithYou";
import { loadTeammatesLastOut } from "@/lib/analysis/loadTeammatesLastOut";
import { computeTireIndicatorsByRunId } from "@/lib/runs/tireSetChange";
import { runSessionName } from "@/lib/runSession";

/** Runs fetched for the recent-runs card; extras beyond the shown rows feed the delta-vs-previous lookback. */
const RECENT_RUNS_LOOKBACK = 12;
/**
 * Three, not four (2026-08-09). The card's footer became a full door row into
 * Sessions — icon well, title and subline — because the old one-line "See all
 * sessions" was the only way into the whole history on a phone and read as fine
 * print. The door takes roughly the height of a run row, so the fourth row pays
 * for it and the card doesn't grow.
 */
const RECENT_RUNS_SHOWN = 3;
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
  tireType: { select: { id: true, displayName: true } },
  tireStintId: true,
  tireAgeKnown: true,
  /**
   * Named on every recent-run row and on the trend card's scope line — the fact that decides
   * whether the lap time beside it means anything. The snapshot is the fallback for a deleted
   * catalog row, exactly as `carNameSnapshot` is for a deleted car.
   */
  trackNameSnapshot: true,
  track: { select: { name: true } },
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

/**
 * Track for a run — the live catalog row first, then the snapshot kept when that row was deleted.
 *
 * Null rather than a placeholder, on purpose: a label reading "No track" is a row spending a line
 * to announce an absence. Callers drop the segment instead.
 */
function trackNameOf(run: AnalysisRunRow): string | null {
  return run.track?.name?.trim() || run.trackNameSnapshot?.trim() || null;
}

/**
 * What the trend chart is actually charting, in words — drawn under the card's title since
 * 2026-08-20. Before that the chart named neither the track nor the day, so "this is your most
 * recent outing" was something the driver had to already know; the string existed but only ever
 * reached the chart's screen-reader description.
 *
 * Founder call (2026-08-20): an event names ITSELF and nothing else. The venue is in the meeting's
 * name or a tap away on the event, and an event weekend has no single date to print, so
 * "Winternationals · Ironbark Raceway · 19 Aug" would be one true line and two redundant ones.
 * Without an event it is the track and the day, which is the pair that identifies a test day.
 *
 * The track is named only when every run in scope shares one. Day scope is a calendar day, not a
 * venue — a club morning and a different track that evening land in the same chart — so naming
 * the latest run's track there would caption the whole picture with one of its halves.
 */
function trendScopeLabel(
  kind: "event" | "day",
  scoped: AnalysisRunRow[],
  latestCreatedAt: Date,
  timeZone: string
): string {
  if (kind === "event") {
    return scoped[scoped.length - 1]?.event?.name?.trim() || "This event";
  }
  const day = formatRunDateOnly(latestCreatedAt, timeZone);
  // A run with no track counts against the set as much as a second track does: "Ironbark · 19 Aug"
  // over a chart that includes a run logged nowhere is still a caption for part of the picture.
  const names = scoped.map(trackNameOf);
  const distinct = new Set(names);
  const soleTrack = distinct.size === 1 ? names[0] : null;
  return soleTrack ? `${soleTrack} · ${day}` : day;
}

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
      sessionName: runSessionName(run, { dayRunNumber: index + 1 }),
      createdAtIso: run.createdAt.toISOString(),
      metrics,
      distribution: computeLapDistribution(run),
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
    scopeLabel: trendScopeLabel(scope.kind, scoped, latest.createdAt, timeZone),
    runs: trendRuns,
    carOptions,
    defaultCarId,
  };
}

/**
 * The scan line under a recent-run row: **"Ironbark Raceway · 19 Aug, 3:42 PM"**.
 *
 * The clean-lap count used to hold this slot and came out on 2026-08-20 to make room (founder
 * call). Only one more phrase fits here at 390px before the line truncates, and between the two
 * the track wins outright: it is the fact that decides whether the lap time on the right of the
 * row means anything at all, while the lap count is second-order and the run page carries it.
 *
 * The year is dropped inside the current year (`formatRunDateShort`) and the date is `19 Aug`
 * rather than `19/08/2026` — the three rows here are always recent, so the long form was spending
 * characters the track now needs.
 *
 * No track logged falls back to the meeting name, then to the timestamp alone. Never a "No track"
 * placeholder — see `trackNameOf`.
 */
function recentRunSubLabel(run: AnalysisRunRow, timeZone: string): string {
  const place = trackNameOf(run) ?? run.event?.name?.trim() ?? null;
  const when = `${formatRunDateShort(run.createdAt, timeZone)}, ${formatRunTimeOnly(
    run.createdAt,
    timeZone
  )}`;
  return place ? `${place} · ${when}` : when;
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
    return {
      id: run.id,
      carId: run.carId,
      title: runRowTitle({ ...run, carName: carNameOf(run) }),
      subLabel: recentRunSubLabel(run, timeZone),
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

/**
 * Server model for the `/analysis` debrief page: trend chart scope (active
 * event, else the latest run's day), the most recent runs, the driver's total
 * run count, and who else was out with them.
 *
 * The latest video-analysis job used to ride along here too. It came off on 2026-08-19 — `/tools`
 * carries a full Video band over the same job list, so a page about reviewing the day was the
 * second front door to a queue, and the smaller one.
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

  const [trend, recentRuns, totalRunCount, teamCount, meeting, lastOut] = await Promise.all([
    latest ? loadTrendModel(userId, latest, timeZone) : Promise.resolve(null),
    loadRecentRuns(userId, timeZone),
    // The number on the Sessions door. One indexed count on `userId`, inside a
    // read that is already cached for 30s — it runs on a miss, not per render.
    perfSpan("analysisTotalRunCount", () => prisma.run.count({ where: { userId } })),
    // Membership only — the door needs to know IF he is on a team, never which one.
    // Rides this wave, so it costs no extra round trip.
    perfSpan("analysisTeamCount", () => prisma.teamMembership.count({ where: { userId } })),
    // The two halves of the Teammates card, loaded side by side because they share nothing: one
    // is scoped by who was at the track, the other by who is on your team.
    loadOutWithYou(userId, timeZone),
    loadTeammatesLastOut(userId),
  ]);

  return {
    trend,
    recentRuns,
    totalRunCount,
    hasTeam: teamCount > 0,
    // Dropped only when BOTH halves are empty. A driver with a team but no shared meeting still
    // gets the band, and a driver with a meeting but no team still gets the comparison.
    teammates: meeting || lastOut.length > 0 ? { meeting, lastOut } : null,
  };
}
