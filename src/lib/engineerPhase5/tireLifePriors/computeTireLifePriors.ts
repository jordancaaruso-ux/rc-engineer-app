import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getAverageTopN,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import type {
  TireLifeConfidence,
  TireLifeFocusedCompareNudgeV1,
  TireLifePriorsV1,
  TireLifeStepAggV1,
} from "@/lib/engineerPhase5/tireLifePriors/tireLifePriorsTypes";

const MAX_RUNS = 420;
const MIN_PAIRS_PUBLISH = 2;
const HIGH_CONF = 5;
const MEDIUM_CONF = 3;

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
  trackId: string | null;
  tireRunNumber: number;
  lapTimes: unknown;
  lapSession: unknown;
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

function aggregateSteps(
  pairs: Array<{ d: PairDeltas; fromN: number; toN: number }>
): TireLifeStepAggV1[] {
  const byKey = new Map<string, PairDeltas[]>();
  for (const { d, fromN, toN } of pairs) {
    const k = `${fromN}→${toN}`;
    const arr = byKey.get(k) ?? [];
    arr.push(d);
    byKey.set(k, arr);
  }
  const out: TireLifeStepAggV1[] = [];
  for (const [key, samples] of byKey) {
    const [fromS, toS] = key.split("→");
    const fromTireRun = Number(fromS);
    const toTireRun = Number(toS);
    if (!Number.isFinite(fromTireRun) || !Number.isFinite(toTireRun)) continue;
    const pairCount = samples.length;
    if (pairCount < MIN_PAIRS_PUBLISH) continue;
    const bests = samples.map((s) => s.dBest).filter((x): x is number => x != null && Number.isFinite(x));
    const fives = samples.map((s) => s.d5).filter((x): x is number => x != null && Number.isFinite(x));
    const tens = samples.map((s) => s.d10).filter((x): x is number => x != null && Number.isFinite(x));
    const fifteens = samples.map((s) => s.d15).filter((x): x is number => x != null && Number.isFinite(x));
    out.push({
      fromTireRun,
      toTireRun,
      pairCount,
      confidence: confidenceForCount(pairCount),
      bestLapDeltaMedianSeconds: medianfinite(bests),
      avgTop5DeltaMedianSeconds: medianfinite(fives),
      avgTop10DeltaMedianSeconds: medianfinite(tens),
      avgTop15DeltaMedianSeconds: medianfinite(fifteens),
    });
  }
  out.sort((a, b) => a.fromTireRun - b.fromTireRun);
  return out;
}

function buildStepsFromPairs(
  runs: RunRow[],
  trackIdFilter: string | null
): TireLifeStepAggV1[] {
  const sorted = [...runs].sort((a, b) => sortMs(a) - sortMs(b));
  const pairObjs: Array<{ d: PairDeltas; fromN: number; toN: number }> = [];
  for (const curr of sorted) {
    if (curr.tireRunNumber < 2) continue;
    const prev = findImmediatePriorOnSet(sorted, curr);
    if (!prev) continue;
    if (trackIdFilter != null) {
      if (prev.trackId !== trackIdFilter || curr.trackId !== trackIdFilter) continue;
    }
    if (prev.tireRunNumber !== curr.tireRunNumber - 1) continue;
    const d = deltaPair(prev, curr);
    if (!d) continue;
    pairObjs.push({ d, fromN: prev.tireRunNumber, toN: curr.tireRunNumber });
  }
  return aggregateSteps(pairObjs);
}

function sumChainMedians(
  steps: TireLifeStepAggV1[],
  fromRun: number,
  toRun: number,
  metric: "best" | "avg5" | "avg10" | "avg15"
): { sum: number | null; withData: number; total: number } {
  if (toRun <= fromRun) return { sum: null, withData: 0, total: 0 };
  let total = 0;
  let withData = 0;
  let sum = 0;
  for (let k = fromRun; k < toRun; k++) {
    total++;
    const row = steps.find((s) => s.fromTireRun === k && s.toTireRun === k + 1);
    let med: number | null = null;
    if (row) {
      if (metric === "best") med = row.bestLapDeltaMedianSeconds;
      else if (metric === "avg5") med = row.avgTop5DeltaMedianSeconds;
      else if (metric === "avg10") med = row.avgTop10DeltaMedianSeconds;
      else med = row.avgTop15DeltaMedianSeconds;
    }
    if (med != null && Number.isFinite(med)) {
      sum += med;
      withData++;
    }
  }
  if (withData === 0) return { sum: null, withData: 0, total };
  return { sum, withData, total };
}

function buildFocusedNudge(
  stepsAllTracks: TireLifeStepAggV1[],
  compareTn: number,
  primaryTn: number
): TireLifeFocusedCompareNudgeV1 | null {
  if (primaryTn <= compareTn) return null;
  const totalSteps = primaryTn - compareTn;
  const b = sumChainMedians(stepsAllTracks, compareTn, primaryTn, "best");
  const f5 = sumChainMedians(stepsAllTracks, compareTn, primaryTn, "avg5");
  const f10 = sumChainMedians(stepsAllTracks, compareTn, primaryTn, "avg10");
  const f15 = sumChainMedians(stepsAllTracks, compareTn, primaryTn, "avg15");
  return {
    compareTireRun: compareTn,
    primaryTireRun: primaryTn,
    totalSteps,
    stepsWithDataBest: b.withData,
    stepsWithDataAvgTop5: f5.withData,
    stepsWithDataAvgTop10: f10.withData,
    stepsWithDataAvgTop15: f15.withData,
    summedBestDeltaMedianSeconds: b.sum,
    summedAvgTop5DeltaMedianSeconds: f5.sum,
    summedAvgTop10DeltaMedianSeconds: f10.sum,
    summedAvgTop15DeltaMedianSeconds: f15.sum,
  };
}

export async function computeTireLifePriorsV1(params: {
  userId: string;
  tireSetId: string;
  anchorTrackId: string | null;
  anchorTrackName: string | null;
  tireSetLabel: string | null;
  /** Optional focused compare (same tire set): primary tire run vs compare tire run. */
  focusedCompareTireRuns: null | { compare: number; primary: number };
}): Promise<TireLifePriorsV1 | null> {
  const tid = params.tireSetId.trim();
  if (!tid) return null;

  const runs = await prisma.run.findMany({
    where: {
      userId: params.userId,
      tireSetId: tid,
      loggingComplete: true,
    },
    orderBy: { createdAt: "desc" },
    take: MAX_RUNS,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      trackId: true,
      tireRunNumber: true,
      lapTimes: true,
      lapSession: true,
    },
  });

  if (runs.length < MIN_PAIRS_PUBLISH) return null;

  const allYourTracksOnSet = buildStepsFromPairs(runs, null);
  const atAnchorTrack =
    params.anchorTrackId?.trim() != null
      ? buildStepsFromPairs(runs, params.anchorTrackId.trim())
      : [];

  let focusedCompareNudge: TireLifeFocusedCompareNudgeV1 | null = null;
  if (params.focusedCompareTireRuns) {
    const { compare, primary } = params.focusedCompareTireRuns;
    if (primary > compare) {
      const nudge = buildFocusedNudge(allYourTracksOnSet, compare, primary);
      const anyData =
        nudge &&
        (nudge.stepsWithDataBest > 0 ||
          nudge.stepsWithDataAvgTop5 > 0 ||
          nudge.stepsWithDataAvgTop10 > 0 ||
          nudge.stepsWithDataAvgTop15 > 0);
      if (anyData) focusedCompareNudge = nudge;
    }
  }

  if (
    allYourTracksOnSet.length === 0 &&
    atAnchorTrack.length === 0 &&
    focusedCompareNudge == null
  ) {
    return null;
  }

  return {
    version: 1,
    tireSetId: tid,
    tireSetLabel: params.tireSetLabel,
    anchorTrackId: params.anchorTrackId,
    anchorTrackName: params.anchorTrackName,
    atAnchorTrack,
    allYourTracksOnSet,
    focusedCompareNudge,
  };
}

/** Loads tire set label; returns null if run missing or has no tire set. */
export async function buildTireLifePriorsForChatContext(params: {
  userId: string;
  anchorRunId: string | null;
  focusedPair: null | {
    primaryTireRun: number;
    compareTireRun: number | null;
    sameTireSet: boolean;
  };
}): Promise<TireLifePriorsV1 | null> {
  const rid = params.anchorRunId?.trim();
  if (!rid) return null;

  const run = await prisma.run.findFirst({
    where: { id: rid, userId: params.userId },
    select: {
      tireSetId: true,
      trackId: true,
      tireSet: { select: { label: true } },
      track: { select: { name: true } },
    },
  });
  if (!run?.tireSetId) return null;

  let focusedCompareTireRuns: null | { compare: number; primary: number } = null;
  if (
    params.focusedPair?.sameTireSet &&
    params.focusedPair.compareTireRun != null &&
    params.focusedPair.primaryTireRun > params.focusedPair.compareTireRun
  ) {
    focusedCompareTireRuns = {
      compare: params.focusedPair.compareTireRun,
      primary: params.focusedPair.primaryTireRun,
    };
  }

  return computeTireLifePriorsV1({
    userId: params.userId,
    tireSetId: run.tireSetId,
    anchorTrackId: run.trackId,
    anchorTrackName: run.track?.name ?? null,
    tireSetLabel: run.tireSet?.label ?? null,
    focusedCompareTireRuns,
  });
}
