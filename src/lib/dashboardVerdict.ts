/**
 * Track-day verdict math — the computed-only "three instruments" behind the
 * dashboard's day-verdict card (docs/DASHBOARD_NORTH_STAR.md, v2 2026-07-19):
 * pace trend across today's runs, whether the last setup change helped, and
 * lap consistency. Pure functions, no AI, no DB — dashboardServer builds the
 * inputs from today's runs.
 */

export type VerdictChangedRow = {
  key: string;
  label: string;
  unit: string;
  previous: string | null;
  current: string;
};

export type VerdictRunInput = {
  runLabel: string;
  bestLap: number | null;
  avgTop5: number | null;
  /** Spread (max − min) of the run's five best included laps; null when the run has fewer than 5 laps. */
  top5SpreadSeconds: number | null;
  changedRows: VerdictChangedRow[];
};

export type TodayVerdict = {
  runCount: number;
  /** Day direction over runs that have the chosen metric; null with fewer than 2 comparable runs. */
  trend: null | {
    direction: "faster" | "slower" | "steady";
    /** Last comparable run minus first (negative = faster). */
    delta: number;
    metric: "avg" | "best";
    /** Chronological per-run metric values — the sparkline. */
    spark: number[];
  };
  /** The run holding today's best lap. */
  bestRun: null | { runLabel: string; bestLap: number | null; avgTop5: number | null };
  /** The most recent run that changed setup, and what that change did to pace. */
  lastChange: null | {
    runLabel: string;
    rows: VerdictChangedRow[];
    /** Metric delta vs the nearest earlier run today with the same metric; null when incomparable. */
    delta: number | null;
    metric: "avg" | "best";
    verdict: "helped" | "hurt" | "unclear";
  };
  /** Lap repeatability of the latest run with enough laps to judge. */
  consistency: null | {
    runLabel: string;
    spreadSeconds: number;
    word: "Tight" | "Fair" | "Scrappy";
  };
};

/** Deltas inside ±this many seconds read as noise, not a direction. */
const STEADY_BAND_SECONDS = 0.05;

function pickMetric(runs: VerdictRunInput[]): "avg" | "best" {
  // Avg top 5 is the less noisy day-trend signal; fall back to best lap when
  // fewer than two runs carry an average (e.g. short runs).
  const withAvg = runs.filter((r) => r.avgTop5 != null).length;
  return withAvg >= 2 ? "avg" : "best";
}

function metricValue(run: VerdictRunInput, metric: "avg" | "best"): number | null {
  return metric === "avg" ? run.avgTop5 : run.bestLap;
}

/**
 * @param runs today's runs in chronological order (first logged first).
 */
export function computeTodayVerdict(runs: VerdictRunInput[]): TodayVerdict | null {
  if (runs.length === 0) return null;

  const metric = pickMetric(runs);
  const series = runs
    .map((r) => metricValue(r, metric))
    .filter((v): v is number => v != null);

  let trend: TodayVerdict["trend"] = null;
  if (series.length >= 2) {
    const delta = series[series.length - 1] - series[0];
    trend = {
      direction:
        delta <= -STEADY_BAND_SECONDS ? "faster" : delta >= STEADY_BAND_SECONDS ? "slower" : "steady",
      delta,
      metric,
      spark: series,
    };
  }

  let bestRun: TodayVerdict["bestRun"] = null;
  for (const r of runs) {
    if (r.bestLap != null && (bestRun?.bestLap == null || r.bestLap < bestRun.bestLap)) {
      bestRun = { runLabel: r.runLabel, bestLap: r.bestLap, avgTop5: r.avgTop5 };
    }
  }
  if (!bestRun) {
    // No laps anywhere today — still name the latest run so the card has a subject.
    const last = runs[runs.length - 1];
    bestRun = { runLabel: last.runLabel, bestLap: null, avgTop5: last.avgTop5 };
  }

  let lastChange: TodayVerdict["lastChange"] = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].changedRows.length === 0) continue;
    const changed = runs[i];
    // Compare the changed run against the nearest EARLIER run today that has
    // the same metric — prefer avg (steadier), fall back to best-vs-best.
    let delta: number | null = null;
    let changeMetric: "avg" | "best" = "avg";
    for (const m of ["avg", "best"] as const) {
      const cur = metricValue(changed, m);
      if (cur == null) continue;
      for (let j = i - 1; j >= 0; j--) {
        const prev = metricValue(runs[j], m);
        if (prev != null) {
          delta = cur - prev;
          changeMetric = m;
          break;
        }
      }
      if (delta != null) break;
    }
    lastChange = {
      runLabel: changed.runLabel,
      rows: changed.changedRows,
      delta,
      metric: changeMetric,
      verdict:
        delta == null
          ? "unclear"
          : delta <= -STEADY_BAND_SECONDS
            ? "helped"
            : delta >= STEADY_BAND_SECONDS
              ? "hurt"
              : "unclear",
    };
    break;
  }

  let consistency: TodayVerdict["consistency"] = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (r.top5SpreadSeconds == null) continue;
    // Judge the spread relative to lap length so 5ths and 12ths get the same
    // bar: within 1% of the best lap is tight, within 2.5% fair, beyond scrappy.
    const ratio = r.bestLap != null && r.bestLap > 0 ? r.top5SpreadSeconds / r.bestLap : null;
    const word: "Tight" | "Fair" | "Scrappy" =
      ratio != null
        ? ratio <= 0.01
          ? "Tight"
          : ratio <= 0.025
            ? "Fair"
            : "Scrappy"
        : r.top5SpreadSeconds <= 0.15
          ? "Tight"
          : r.top5SpreadSeconds <= 0.4
            ? "Fair"
            : "Scrappy";
    consistency = { runLabel: r.runLabel, spreadSeconds: r.top5SpreadSeconds, word };
    break;
  }

  return { runCount: runs.length, trend, bestRun, lastChange, consistency };
}
