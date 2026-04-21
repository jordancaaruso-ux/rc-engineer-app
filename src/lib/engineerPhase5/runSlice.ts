import "server-only";

import { prisma } from "@/lib/prisma";
import { getIncludedLapDashboardMetrics, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { listSetupKeysChangedBetweenSnapshots } from "@/lib/setupCompare/listSetupKeysChangedBetweenSnapshots";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import type { PatternDigestRunRow } from "@/lib/engineerPhase5/patternDigestTypes";
import type { RunSliceV1 } from "@/lib/engineerPhase5/runSliceTypes";

export type { RunSliceV1 } from "@/lib/engineerPhase5/runSliceTypes";

function clampNote(s: string | null | undefined, max: number): string | null {
  const t = s?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function sortInstantMs(run: { createdAt: Date; sessionCompletedAt: Date | null }): number {
  return resolveRunDisplayInstant({
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt,
  }).getTime();
}

/**
 * Account-scoped filtered runs with PatternDigest-shaped rows (notes, lap summary, setup delta).
 * Chronological order (oldest→newest). Setup deltas only vs the immediately previous run when same car.
 */
export async function buildRunSliceV1(params: {
  userId: string;
  carId?: string | null;
  trackId?: string | null;
  eventId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
}): Promise<RunSliceV1 | null> {
  const limit = Math.min(80, Math.max(5, params.limit ?? 40));

  const where: NonNullable<Parameters<typeof prisma.run.findMany>[0]>["where"] = {
    userId: params.userId,
  };
  if (params.carId?.trim()) where.carId = params.carId.trim();
  if (params.trackId?.trim()) where.trackId = params.trackId.trim();
  if (params.eventId?.trim()) where.eventId = params.eventId.trim();

  if (params.carId?.trim()) {
    const car = await prisma.car.findFirst({
      where: { id: params.carId.trim(), userId: params.userId },
      select: { id: true },
    });
    if (!car) return null;
  }

  const raw = await prisma.run.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 800,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      eventId: true,
      trackId: true,
      lapTimes: true,
      lapSession: true,
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      carId: true,
      carNameSnapshot: true,
      setupSnapshot: { select: { data: true } },
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
    },
  });

  let rows = raw.map((r) => ({ run: r, t: sortInstantMs(r) }));

  if (params.dateFrom?.trim() || params.dateTo?.trim()) {
    const from = params.dateFrom?.trim()
      ? new Date(`${params.dateFrom.trim()}T00:00:00.000`)
      : null;
    const to = params.dateTo?.trim() ? new Date(`${params.dateTo.trim()}T23:59:59.999`) : null;
    rows = rows.filter(({ t }) => {
      const d = new Date(t);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  rows.sort((a, b) => a.t - b.t);
  rows = rows.slice(-limit);

  const out: PatternDigestRunRow[] = [];
  let prevSetup: unknown = undefined;
  let prevCarId: string | null = null;

  let bestLapRunId: string | null = null;
  let bestLapSeconds: number | null = null;

  for (const { run } of rows) {
    const rowsLaps = primaryLapRowsFromRun(run);
    const dash = getIncludedLapDashboardMetrics(rowsLaps);
    const best = dash.bestLap;

    if (best != null && Number.isFinite(best)) {
      if (bestLapSeconds == null || best < bestLapSeconds) {
        bestLapSeconds = best;
        bestLapRunId = run.id;
      }
    }

    let setupKeysChangedFromPrevious: string[] | null = null;
    const sameCarAsPrev =
      prevCarId != null && run.carId != null && run.carId === prevCarId && prevSetup !== undefined;
    if (sameCarAsPrev) {
      setupKeysChangedFromPrevious = listSetupKeysChangedBetweenSnapshots(
        run.setupSnapshot?.data,
        prevSetup,
        { keyFilter: isTuningComparisonKey }
      );
      if (setupKeysChangedFromPrevious.length === 0) setupKeysChangedFromPrevious = [];
    }

    prevSetup = run.setupSnapshot?.data;
    prevCarId = run.carId;

    const note =
      run.notes?.trim() ||
      [run.driverNotes, run.handlingProblems].filter(Boolean).join(" · ") ||
      null;

    out.push({
      runId: run.id,
      sortIso: new Date(sortInstantMs(run)).toISOString(),
      carId: run.carId,
      carName: run.car?.name ?? run.carNameSnapshot ?? "—",
      trackName: run.track?.name ?? "—",
      eventName: run.event?.name ?? null,
      lapSummary: {
        lapCount: dash.lapCount,
        bestLapSeconds: dash.bestLap,
        avgTop5Seconds: dash.avgTop5,
        avgTop10Seconds: dash.avgTop10,
        consistencyScore: dash.consistencyScore,
      },
      setupKeysChangedFromPrevious,
      notesPreview: clampNote(note, 160),
    });
  }

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    filters: {
      carId: params.carId?.trim() || null,
      trackId: params.trackId?.trim() || null,
      eventId: params.eventId?.trim() || null,
      dateFrom: params.dateFrom?.trim() || null,
      dateTo: params.dateTo?.trim() || null,
      limit,
    },
    runs: out,
    highlight: { bestLapRunId, bestLapSeconds },
  };
}
