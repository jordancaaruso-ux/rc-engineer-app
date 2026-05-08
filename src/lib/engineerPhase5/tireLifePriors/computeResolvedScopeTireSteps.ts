import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getAverageTopN,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import type {
  ResolvedScopeTireStepBucketV1,
  ResolvedScopeTireStepsV1,
  TireLifeConfidence,
} from "@/lib/engineerPhase5/tireLifePriors/tireLifePriorsTypes";

const MIN_PAIRS_PUBLISH = 2;
const HIGH_CONF = 5;
const MEDIUM_CONF = 3;
const MAX_EXAMPLE_PAIRS = 4;

function sortMs(run: { createdAt: Date; sessionCompletedAt: Date | null }): number {
  return resolveRunDisplayInstant({
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt,
  }).getTime();
}

function confidenceForCount(n: number): TireLifeConfidence {
  if (n >= HIGH_CONF) return "high";
  if (n >= MEDIUM_CONF) return "medium";
  return "low";
}

function medianfinite(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

type RunRow = {
  id: string;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  eventId: string | null;
  trackId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
  lapTimes: unknown;
  lapSession: unknown;
  tireSet: { label: string | null } | null;
  event: { name: string } | null;
  track: { name: string } | null;
};

function lapMetricsForPriors(run: RunRow) {
  const rows = primaryLapRowsFromRun(run);
  const dash = getIncludedLapDashboardMetrics(rows);
  const n = dash.lapCount;
  return {
    best: dash.bestLap,
    avg5: n >= 5 ? dash.avgTop5 : null,
    avg10: n >= 10 ? dash.avgTop10 : null,
    avg15: n >= 15 ? getAverageTopN(rows, 15) : null,
  };
}

type PairDeltas = {
  dBest: number | null;
  d5: number | null;
  d10: number | null;
  d15: number | null;
};

function deltaPair(prev: RunRow, curr: RunRow): PairDeltas | null {
  const a = lapMetricsForPriors(prev);
  const b = lapMetricsForPriors(curr);
  if (a.best == null || b.best == null) return null;
  return {
    dBest: b.best - a.best,
    d5:
      a.avg5 != null && b.avg5 != null && Number.isFinite(a.avg5) && Number.isFinite(b.avg5)
        ? b.avg5 - a.avg5
        : null,
    d10:
      a.avg10 != null && b.avg10 != null && Number.isFinite(a.avg10) && Number.isFinite(b.avg10)
        ? b.avg10 - a.avg10
        : null,
    d15:
      a.avg15 != null && b.avg15 != null && Number.isFinite(a.avg15) && Number.isFinite(b.avg15)
        ? b.avg15 - a.avg15
        : null,
  };
}

function findImmediatePriorOnSet(sortedAsc: RunRow[], curr: RunRow): RunRow | null {
  const tCur = sortMs(curr);
  if (curr.tireRunNumber < 2) return null;
  const need = curr.tireRunNumber - 1;
  let best: RunRow | null = null;
  let bestT = -Infinity;
  for (const r of sortedAsc) {
    if (r.tireRunNumber !== need) continue;
    const t = sortMs(r);
    if (t < tCur && t > bestT) {
      bestT = t;
      best = r;
    }
  }
  return best;
}

function bucketKey(eventId: string | null, trackId: string | null): string {
  return `${eventId ?? "__no_event__"}\t${trackId ?? "__no_track__"}`;
}

/**
 * Pooled **tire run 1→2** pace deltas across multiple tire sets, restricted to runs in `runIds`
 * (typically resolvedRunScope). One bucket per (eventId × trackId).
 */
export async function computeResolvedScopeTireStepsV1(params: {
  userId: string;
  runIds: string[];
  /** Optional case-insensitive substring on tire set label; omit for no filter. */
  tireLabelContains?: string | null;
}): Promise<ResolvedScopeTireStepsV1 | null> {
  const ids = [...new Set(params.runIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length < 2) return null;

  const labelNeedle = params.tireLabelContains?.trim().toLowerCase() || null;

  const runs = await prisma.run.findMany({
    where: {
      userId: params.userId,
      id: { in: ids },
      loggingComplete: true,
      tireSetId: { not: null },
    },
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      eventId: true,
      trackId: true,
      tireSetId: true,
      tireRunNumber: true,
      lapTimes: true,
      lapSession: true,
      tireSet: { select: { label: true } },
      event: { select: { name: true } },
      track: { select: { name: true } },
    },
  });

  const filtered =
    labelNeedle == null
      ? runs
      : runs.filter((r) => (r.tireSet?.label ?? "").toLowerCase().includes(labelNeedle));

  type PairSample = {
    d: PairDeltas;
    tireSetId: string;
    tireSetLabel: string | null;
    fromRunId: string;
    toRunId: string;
  };

  const byBucket = new Map<string, RunRow[]>();
  for (const r of filtered) {
    const k = bucketKey(r.eventId, r.trackId);
    const arr = byBucket.get(k) ?? [];
    arr.push(r as RunRow);
    byBucket.set(k, arr);
  }

  const bucketsOut: ResolvedScopeTireStepBucketV1[] = [];

  for (const group of byBucket.values()) {
    const bySet = new Map<string, RunRow[]>();
    for (const r of group) {
      const sid = r.tireSetId;
      if (!sid) continue;
      const arr = bySet.get(sid) ?? [];
      arr.push(r);
      bySet.set(sid, arr);
    }

    const pairSamples: PairSample[] = [];

    for (const setRuns of bySet.values()) {
      const sorted = [...setRuns].sort((a, b) => sortMs(a) - sortMs(b));
      for (const curr of sorted) {
        if (curr.tireRunNumber !== 2) continue;
        const prev = findImmediatePriorOnSet(sorted, curr);
        if (!prev || prev.tireRunNumber !== 1) continue;
        const d = deltaPair(prev, curr);
        if (!d) continue;
        const tid = curr.tireSetId!;
        pairSamples.push({
          d,
          tireSetId: tid,
          tireSetLabel: curr.tireSet?.label ?? null,
          fromRunId: prev.id,
          toRunId: curr.id,
        });
      }
    }

    if (pairSamples.length < MIN_PAIRS_PUBLISH) continue;

    const distinctSets = new Set(pairSamples.map((p) => p.tireSetId));
    const any = pairSamples[0]!;
    const metaFrom = group.find((r) => r.id === any.fromRunId || r.id === any.toRunId);

    const bests = pairSamples.map((p) => p.d.dBest).filter((x): x is number => x != null);
    const fives = pairSamples.map((p) => p.d.d5).filter((x): x is number => x != null);
    const tens = pairSamples.map((p) => p.d.d10).filter((x): x is number => x != null);
    const fifteens = pairSamples.map((p) => p.d.d15).filter((x): x is number => x != null);

    const examplePairs = pairSamples.slice(0, MAX_EXAMPLE_PAIRS).map((p) => ({
      fromRunId: p.fromRunId,
      toRunId: p.toRunId,
      tireSetId: p.tireSetId,
      tireSetLabel: p.tireSetLabel,
    }));

    bucketsOut.push({
      eventId: metaFrom?.eventId ?? null,
      eventName: metaFrom?.event?.name ?? null,
      trackId: metaFrom?.trackId ?? null,
      trackName: metaFrom?.track?.name ?? null,
      pairCount: pairSamples.length,
      distinctTireSetCount: distinctSets.size,
      confidence: confidenceForCount(pairSamples.length),
      bestLapDeltaMedianSeconds: medianfinite(bests),
      avgTop5DeltaMedianSeconds: medianfinite(fives),
      avgTop10DeltaMedianSeconds: medianfinite(tens),
      avgTop15DeltaMedianSeconds: medianfinite(fifteens),
      examplePairs,
    });
  }

  if (bucketsOut.length === 0) return null;

  bucketsOut.sort((a, b) => {
    const ea = a.eventName ?? "";
    const eb = b.eventName ?? "";
    if (ea !== eb) return ea.localeCompare(eb);
    const ta = a.trackName ?? "";
    const tb = b.trackName ?? "";
    return ta.localeCompare(tb);
  });

  return {
    version: 1,
    tireLabelFilter: labelNeedle != null ? (params.tireLabelContains?.trim() ?? null) : null,
    buckets: bucketsOut,
  };
}
