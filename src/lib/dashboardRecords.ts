/**
 * Dashboard "records" — the noise-proof progression spine that replaced the
 * old 30-day pace trend (2026-07-10). A record only ever moves when the driver
 * genuinely beats it, so a single slow run can never read as "getting slower"
 * (the exact flaw the pace trend had).
 *
 * Per track+class we hold three all-time bests:
 *   - `bestLap`   — fastest single timed lap
 *   - `avgTop5`   — fastest 5-lap average (the 5 quickest laps, race-ish pace)
 *   - `racePace`  — best average over any 5 CONSECUTIVE laps (sustained pace,
 *                   no cherry-picking) — distinct from avgTop5
 *
 * Pure aggregation so it unit-tests without Prisma (mirrors `dashboardSummary`):
 * the loader maps run rows to `RecordRunInput` and this file groups + reduces.
 *
 * Trust rule (see PRODUCT_NORTH_STAR): lap times are NOT comparable across
 * tracks or classes, so records are always scoped to a single track+class.
 */

import { getIncludedLaps, primaryLapRowsFromRun } from "@/lib/lapAnalysis";

/** Consecutive-lap window that defines "race pace" (sustained, not cherry-picked). */
const RACE_PACE_WINDOW = 5;
/** Float slop when deciding one lap time genuinely beats another. */
const EPSILON = 1e-4;

/** One completed run reduced to what the records board needs. */
export type RecordRunInput = {
  runId: string;
  /** Effective display instant (resolveRunDisplayInstant) — for recency ranking. */
  effectiveAt: Date;
  trackId: string | null;
  trackName: string | null;
  /** Race class label (part of the comparability key). */
  className: string | null;
  /** Materialized best lap; falls back to the min included lap when null. */
  bestLapSeconds: number | null;
  /** Materialized avg-top-5; falls back to the top-5 mean of included laps when null. */
  avgTop5Seconds: number | null;
  lapTimes: unknown;
  lapSession?: unknown;
};

export type DashboardRecordMetric = "best" | "avgTop5" | "racePace";

export type DashboardRecord = {
  trackName: string;
  className: string | null;
  /** Timed runs at this track+class that fed the records. */
  runsCount: number;
  /** ISO instant of the most recent run here (drives ordering — active tracks first). */
  lastRunAt: string;
  bestLap: number | null;
  avgTop5: number | null;
  racePace: number | null;
  /** Which metric the freshest run just set a NEW record for here (else null). */
  freshPbMetric: DashboardRecordMetric | null;
};

/** A record the most-recent run just broke — drives the celebration surfaces. */
export type DashboardNewPb = {
  trackName: string;
  className: string | null;
  metric: DashboardRecordMetric;
  /** The new (winning) value. */
  value: number;
  /** The prior best it beat (so the UI can show "−0.08 on old"). */
  previousValue: number;
};

export type DashboardRecordsResult = {
  records: DashboardRecord[];
  /** Set when `recentRunId` genuinely beat an existing record at its track+class. */
  newPb: DashboardNewPb | null;
};

type RunMetrics = { best: number | null; avgTop5: number | null; racePace: number | null };

/** Mean of the `n` fastest laps; null when there are no timed laps. */
function topNMean(times: number[], n: number): number | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const take = Math.min(n, sorted.length);
  let sum = 0;
  for (let i = 0; i < take; i++) sum += sorted[i];
  return sum / take;
}

/** Best (lowest) average over any window of `n` CONSECUTIVE laps; null when < n laps. */
function bestConsecutiveMean(times: number[], n: number): number | null {
  if (times.length < n) return null;
  let windowSum = 0;
  for (let i = 0; i < n; i++) windowSum += times[i];
  let best = windowSum;
  for (let i = n; i < times.length; i++) {
    windowSum += times[i] - times[i - n];
    if (windowSum < best) best = windowSum;
  }
  return best / n;
}

/** Per-run best / avg-top-5 / race-pace, preferring materialized columns. */
function runMetrics(r: RecordRunInput): RunMetrics {
  const times = getIncludedLaps(primaryLapRowsFromRun(r))
    .map((l) => l.lapTimeSeconds)
    .filter((t) => typeof t === "number" && Number.isFinite(t));
  const best =
    typeof r.bestLapSeconds === "number" && Number.isFinite(r.bestLapSeconds)
      ? r.bestLapSeconds
      : times.length
        ? Math.min(...times)
        : null;
  const avgTop5 =
    typeof r.avgTop5Seconds === "number" && Number.isFinite(r.avgTop5Seconds)
      ? r.avgTop5Seconds
      : topNMean(times, 5);
  const racePace = bestConsecutiveMean(times, RACE_PACE_WINDOW);
  return { best, avgTop5, racePace };
}

/** Lower of two nullable times (records are always the minimum). */
function minNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

type Group = {
  trackName: string;
  className: string | null;
  runs: Array<{ runId: string; effectiveAt: Date; metrics: RunMetrics }>;
};

/**
 * Group completed runs by track+class and reduce each to its all-time bests.
 * When `recentRunId` is supplied and that run beat a pre-existing record at its
 * track+class, the beaten metric is flagged (`freshPbMetric` / `newPb`).
 */
export function computeDashboardRecords(
  rows: RecordRunInput[],
  recentRunId?: string | null
): DashboardRecordsResult {
  const groups = new Map<string, Group>();

  for (const r of rows) {
    // Need a track to form a comparable record key; class may be null.
    if (!r.trackId) continue;
    const metrics = runMetrics(r);
    if (metrics.best == null && metrics.avgTop5 == null && metrics.racePace == null) continue;
    const key = `${r.trackId}::${r.className ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.runs.push({ runId: r.runId, effectiveAt: r.effectiveAt, metrics });
    } else {
      groups.set(key, {
        trackName: r.trackName ?? "your track",
        className: r.className,
        runs: [{ runId: r.runId, effectiveAt: r.effectiveAt, metrics }],
      });
    }
  }

  let newPb: DashboardNewPb | null = null;

  const records: DashboardRecord[] = [...groups.values()].map((g) => {
    let bestLap: number | null = null;
    let avgTop5: number | null = null;
    let racePace: number | null = null;
    let lastRunAt = g.runs[0].effectiveAt;
    for (const run of g.runs) {
      bestLap = minNullable(bestLap, run.metrics.best);
      avgTop5 = minNullable(avgTop5, run.metrics.avgTop5);
      racePace = minNullable(racePace, run.metrics.racePace);
      if (run.effectiveAt.getTime() > lastRunAt.getTime()) lastRunAt = run.effectiveAt;
    }

    // Fresh-PB check: did the most-recent run set a record NOBODY else here holds?
    // Requires ≥2 runs (you can only "beat" a prior best) — a first run isn't a PB.
    let freshPbMetric: DashboardRecordMetric | null = null;
    if (recentRunId && g.runs.length >= 2) {
      const recent = g.runs.find((run) => run.runId === recentRunId);
      if (recent) {
        const others = g.runs.filter((run) => run.runId !== recentRunId);
        freshPbMetric = detectFreshMetric(recent.metrics, others.map((o) => o.metrics));
        if (freshPbMetric && !newPb) {
          // const so the narrowing survives inside the .map() closure below.
          const metric = freshPbMetric;
          const value = recent.metrics[metric];
          const previousValue = bestOf(others.map((o) => o.metrics[metric]));
          if (value != null && previousValue != null) {
            newPb = {
              trackName: g.trackName,
              className: g.className,
              metric,
              value,
              previousValue,
            };
          }
        }
      }
    }

    return {
      trackName: g.trackName,
      className: g.className,
      runsCount: g.runs.length,
      lastRunAt: lastRunAt.toISOString(),
      bestLap,
      avgTop5,
      racePace,
      freshPbMetric,
    };
  });

  // Most recently active track+class first (that's what the driver is racing now).
  records.sort((a, b) => Date.parse(b.lastRunAt) - Date.parse(a.lastRunAt) || b.runsCount - a.runsCount);

  return { records, newPb };
}

/** The best (min) of a list of nullable times, or null when all null. */
function bestOf(values: Array<number | null>): number | null {
  let best: number | null = null;
  for (const v of values) best = minNullable(best, v);
  return best;
}

/**
 * Which metric (if any) `recent` sets a strictly-better record for vs everyone
 * else. Priority best → avgTop5 → racePace, so the most headline-worthy wins.
 */
function detectFreshMetric(recent: RunMetrics, others: RunMetrics[]): DashboardRecordMetric | null {
  const metrics: DashboardRecordMetric[] = ["best", "avgTop5", "racePace"];
  for (const metric of metrics) {
    const mine = recent[metric];
    if (mine == null) continue;
    const theirs = bestOf(others.map((o) => o[metric]));
    if (theirs != null && mine < theirs - EPSILON) return metric;
  }
  return null;
}

/** Human label for a record metric, for celebration/UI copy. */
export function recordMetricLabel(metric: DashboardRecordMetric): string {
  switch (metric) {
    case "best":
      return "best lap";
    case "avgTop5":
      return "best avg top-5";
    case "racePace":
      return "best race pace";
  }
}
