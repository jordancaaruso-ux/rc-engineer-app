import "server-only";

import { prisma } from "@/lib/prisma";
import { getIncludedLapDashboardMetrics, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import type { RunCatalogV1, RunCatalogRow } from "@/lib/engineerPhase5/runCatalogTypes";

export type { RunCatalogV1, RunCatalogRow } from "@/lib/engineerPhase5/runCatalogTypes";

const DEFAULT_MAX_ROWS = 400;
const DEFAULT_MAX_JSON_BYTES = 140_000;

function sortInstantMs(run: { createdAt: Date; sessionCompletedAt: Date | null }): number {
  return resolveRunDisplayInstant({
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt,
  }).getTime();
}

/**
 * Compact inventory of the user's runs for Engineer context (no per-lap arrays, no setup JSON).
 * Newest runs first. Truncates by row count and optionally by approximate JSON size.
 */
export async function buildRunCatalogV1(params: {
  userId: string;
  maxRows?: number;
  maxJsonBytes?: number;
}): Promise<RunCatalogV1> {
  const maxRows = Math.min(800, Math.max(50, params.maxRows ?? DEFAULT_MAX_ROWS));
  const maxJsonBytes = Math.max(40_000, params.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES);

  const totalRunCount = await prisma.run.count({ where: { userId: params.userId } });

  const raw = await prisma.run.findMany({
    where: { userId: params.userId },
    orderBy: { createdAt: "desc" },
    take: maxRows,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      sessionLabel: true,
      lapTimes: true,
      lapSession: true,
      carId: true,
      carNameSnapshot: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
    },
  });

  let rows: RunCatalogRow[] = raw.map((run) => {
    const dash = getIncludedLapDashboardMetrics(primaryLapRowsFromRun(run));
    return {
      runId: run.id,
      sortIso: new Date(sortInstantMs(run)).toISOString(),
      carId: run.carId,
      carName: run.car?.name ?? run.carNameSnapshot ?? "—",
      trackName: run.track?.name ?? "—",
      eventName: run.event?.name ?? null,
      sessionSummary: formatRunSessionDisplay({
        sessionType: run.sessionType,
        meetingSessionType: run.meetingSessionType,
        meetingSessionCode: run.meetingSessionCode,
        sessionLabel: run.sessionLabel,
      }),
      lapCount: dash.lapCount,
      bestLapSeconds: dash.bestLap,
    };
  });

  let jsonBytes = Buffer.byteLength(JSON.stringify({ version: 1, rows }), "utf8");
  while (rows.length > 40 && jsonBytes > maxJsonBytes) {
    rows = rows.slice(0, -1);
    jsonBytes = Buffer.byteLength(JSON.stringify({ version: 1, rows }), "utf8");
  }

  const includedRunCount = rows.length;
  const truncated = totalRunCount > includedRunCount;
  const omittedCount = Math.max(0, totalRunCount - includedRunCount);

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    totalRunCount,
    includedRunCount,
    truncated,
    omittedCount,
    rows,
  };
}
