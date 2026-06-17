import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSetupSpreadForEngineer } from "@/lib/engineerPhase5/setupSpreadForEngineer";
import { searchVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import { searchKbChunkIndex } from "@/lib/engineerPhase5/reasoningSpine/kbChunkIndex";
import { matchTracksForEngineerQuery } from "@/lib/engineerPhase5/matchTrackForEngineer";
import {
  getAverageTopN,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { buildTireLifePriorsForChatContext } from "@/lib/engineerPhase5/tireLifePriors/computeTireLifePriors";

function tireHaystack(run: {
  tireSet: {
    label: string | null;
    tireType: { displayName: string; modelCode: string } | null;
  } | null;
}): string {
  return [
    run.tireSet?.tireType?.displayName,
    run.tireSet?.tireType?.modelCode,
    run.tireSet?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesTireNeedle(haystack: string, needle: string): boolean {
  return haystack.includes(needle.trim().toLowerCase());
}

export async function getParamSpreadTool(
  userId: string,
  args: { anchor_run_id: string; parameter_keys?: string[] | null }
): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: string }> {
  const runId = args.anchor_run_id?.trim();
  if (!runId) return { ok: false, error: "anchor_run_id is required." };

  const run = await prisma.run.findFirst({
    where: { id: runId, userId },
    select: {
      carId: true,
      setupSnapshot: { select: { data: true } },
    },
  });
  if (!run?.carId) return { ok: false, error: "Run not found or has no car." };

  const spread = await buildSetupSpreadForEngineer({
    userId,
    carId: run.carId,
    setupSnapshotData: run.setupSnapshot?.data ?? null,
  });

  let rows = spread.rows;
  const keys = args.parameter_keys?.map((k) => k.trim()).filter(Boolean) ?? [];
  if (keys.length > 0) {
    const keySet = new Set(keys);
    rows = rows.filter((r) => keySet.has(r.parameterKey));
  }

  return {
    ok: true,
    rows: rows.slice(0, 40).map((r) => ({
      parameterKey: r.parameterKey,
      label: r.currentDisplay || r.parameterKey,
      currentDisplay: r.currentDisplay,
      positionBand: r.positionBand,
      spreadSource: r.spreadSource,
      communityGripLevel: r.communityGripLevel,
      spread: r.spread
        ? {
            median: r.spread.median,
            mean: r.spread.mean,
            iqr: r.spread.iqr,
            sampleCount: r.spread.sampleCount,
          }
        : null,
      gripTrendSignal: r.gripTrendSignal
        ? {
            magnitude: r.gripTrendSignal.magnitude,
            direction: r.gripTrendSignal.direction,
            meetsMinMeaningfulDelta: r.gripTrendSignal.meetsMinMeaningfulDelta,
          }
        : null,
    })),
  };
}

type TireAggRow = {
  tireLabel: string;
  runCount: number;
  bestLapSeconds: number | null;
  avgTop10Seconds: number | null;
  latestRunId: string | null;
  latestWhenLabel: string | null;
};

async function aggregateRunsByTireLabel(
  runs: Array<{
    id: string;
    createdAt: Date;
    sessionCompletedAt: Date | null;
    loggingCompletedAt: Date | null;
    lapTimes: unknown;
    lapSession: unknown;
    tireSet: {
      label: string | null;
      tireType: { displayName: string; modelCode: string } | null;
    } | null;
  }>,
  timeZone: string
): Promise<TireAggRow[]> {
  const byLabel = new Map<string, TireAggRow>();
  for (const run of runs) {
    const label =
      run.tireSet?.label?.trim() ||
      run.tireSet?.tireType?.displayName?.trim() ||
      "Unknown tire";
    const rows = primaryLapRowsFromRun(run);
    const dash = getIncludedLapDashboardMetrics(rows);
    const best = dash.bestLap;
    const avg10 = dash.lapCount >= 10 ? dash.avgTop10 : null;
    const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(run), timeZone);
    const cur = byLabel.get(label) ?? {
      tireLabel: label,
      runCount: 0,
      bestLapSeconds: null,
      avgTop10Seconds: null,
      latestRunId: null,
      latestWhenLabel: null,
    };
    cur.runCount += 1;
    if (best != null && (cur.bestLapSeconds == null || best < cur.bestLapSeconds)) {
      cur.bestLapSeconds = best;
    }
    if (avg10 != null) {
      const prev = cur.avgTop10Seconds;
      cur.avgTop10Seconds = prev == null ? avg10 : (prev + avg10) / 2;
    }
    cur.latestRunId = run.id;
    cur.latestWhenLabel = when;
    byLabel.set(label, cur);
  }
  return [...byLabel.values()].sort((a, b) => {
    const ba = a.bestLapSeconds ?? 999;
    const bb = b.bestLapSeconds ?? 999;
    return ba - bb;
  });
}

export async function compareTiresTool(
  userId: string,
  args: {
    tire_label_a: string;
    tire_label_b: string;
    track_query?: string | null;
    time_zone?: string | null;
  }
): Promise<{ ok: true; rows: TireAggRow[]; trackName: string | null } | { ok: false; error: string }> {
  const a = args.tire_label_a?.trim();
  const b = args.tire_label_b?.trim();
  if (!a || !b) return { ok: false, error: "tire_label_a and tire_label_b are required." };

  const tz = args.time_zone?.trim() || "UTC";
  let trackIds: string[] | null = null;
  let trackName: string | null = null;
  if (args.track_query?.trim()) {
    const matches = await matchTracksForEngineerQuery(userId, args.track_query.trim());
    if (matches.length === 0) {
      return { ok: false, error: `No track matched "${args.track_query}".` };
    }
    trackIds = matches.slice(0, 3).map((m) => m.id);
    trackName = matches[0]!.name;
  }

  const runs = await prisma.run.findMany({
    where: {
      userId,
      ...(trackIds ? { trackId: { in: trackIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
      lapTimes: true,
      lapSession: true,
      tireSet: {
        select: {
          label: true,
          tireType: { select: { displayName: true, modelCode: true } },
        },
      },
    },
  });

  const filtered = runs.filter((r) => {
    const hay = tireHaystack(r);
    return matchesTireNeedle(hay, a) || matchesTireNeedle(hay, b);
  });

  if (filtered.length === 0) {
    return {
      ok: false,
      error: `No runs found for tires matching "${a}" or "${b}"${trackName ? ` at ${trackName}` : ""}.`,
    };
  }

  const agg = await aggregateRunsByTireLabel(filtered, tz);
  const rows = agg.filter(
    (row) => matchesTireNeedle(row.tireLabel.toLowerCase(), a) || matchesTireNeedle(row.tireLabel.toLowerCase(), b)
  );

  return { ok: true, rows, trackName };
}

export async function tireHistoryAtTrackTool(
  userId: string,
  args: {
    track_query: string;
    tire_label_contains?: string | null;
    time_zone?: string | null;
    max_results?: number;
  }
): Promise<
  | { ok: true; trackName: string; rows: TireAggRow[] }
  | { ok: false; error: string }
> {
  const trackQuery = args.track_query?.trim();
  if (!trackQuery) return { ok: false, error: "track_query is required." };

  const matches = await matchTracksForEngineerQuery(userId, trackQuery);
  if (matches.length === 0) {
    return { ok: false, error: `No track matched "${trackQuery}".` };
  }
  const trackIds = matches.slice(0, 3).map((m) => m.id);
  const trackName = matches[0]!.name;
  const tz = args.time_zone?.trim() || "UTC";
  const max = Math.min(40, Math.max(5, args.max_results ?? 20));

  const runs = await prisma.run.findMany({
    where: { userId, trackId: { in: trackIds } },
    orderBy: { createdAt: "desc" },
    take: 600,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
      lapTimes: true,
      lapSession: true,
      tireSet: {
        select: {
          label: true,
          tireType: { select: { displayName: true, modelCode: true } },
        },
      },
    },
  });

  const needle = args.tire_label_contains?.trim().toLowerCase() ?? null;
  const filtered = needle
    ? runs.filter((r) => matchesTireNeedle(tireHaystack(r), needle))
    : runs;

  const agg = await aggregateRunsByTireLabel(filtered, tz);
  return { ok: true, trackName, rows: agg.slice(0, max) };
}

export async function kbSearchTool(args: {
  query: string;
  limit?: number;
}): Promise<{ ok: true; snippets: Array<{ title: string; excerpt: string; sourcePath: string }> }> {
  const query = args.query?.trim() ?? "";
  const limit = Math.min(12, Math.max(1, args.limit ?? 6));
  if (!query) return { ok: true, snippets: [] };

  const indexed = await searchKbChunkIndex(query, limit);
  if (indexed.length > 0) {
    return {
      ok: true,
      snippets: indexed.map((s) => ({
        title: s.title,
        excerpt: s.excerpt,
        sourcePath: s.sourcePath,
      })),
    };
  }

  const kb = await searchVehicleDynamicsKb(query, limit);
  return {
    ok: true,
    snippets: kb.map((s) => ({
      title: s.title,
      excerpt: s.excerpt,
      sourcePath: s.sourcePath,
    })),
  };
}

export async function tireLifePriorsAtRunTool(
  userId: string,
  args: { anchor_run_id: string }
): Promise<{ ok: true; priors: unknown } | { ok: false; error: string }> {
  const runId = args.anchor_run_id?.trim();
  if (!runId) return { ok: false, error: "anchor_run_id is required." };
  const run = await prisma.run.findFirst({
    where: { id: runId, userId },
    select: { id: true, tireSetId: true },
  });
  if (!run) return { ok: false, error: "Run not found." };
  const priors = await buildTireLifePriorsForChatContext({
    userId,
    anchorRunId: runId,
    focusedPair: null,
  });
  return { ok: true, priors };
}
