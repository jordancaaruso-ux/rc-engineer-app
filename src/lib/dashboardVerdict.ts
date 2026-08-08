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

export type ConsistencyWord = "Tight" | "Fair" | "Scrappy";

/**
 * Judge a top-5 spread relative to lap length, so 5-second laps and 12-second laps
 * get the same bar: within 1% of the best lap is tight, within 2.5% fair, beyond
 * that scrappy. Falls back to absolute seconds when there is no best lap to scale by.
 *
 * Exported because the desktop hero's consistency dial reads the same scale — two
 * copies of these cutoffs would drift, and then the dial and the verdict card would
 * disagree about the same run on the same screen.
 */
export function consistencyWord(
  top5SpreadSeconds: number,
  bestLap: number | null,
): ConsistencyWord {
  const ratio = bestLap != null && bestLap > 0 ? top5SpreadSeconds / bestLap : null;
  if (ratio != null) return ratio <= 0.01 ? "Tight" : ratio <= 0.025 ? "Fair" : "Scrappy";
  return top5SpreadSeconds <= 0.15 ? "Tight" : top5SpreadSeconds <= 0.4 ? "Fair" : "Scrappy";
}

/**
 * The same spread as a 0–10 magnitude, for `RatingDial` in verdict mode. Anchored on
 * the word cutoffs above: a tight run (≤1%) lands at 7.5+, the fair band spans roughly
 * 3.75–7.5, and scrappy falls below. It is the arc length and colour only — the dial
 * prints the word, never this number.
 */
export function consistencyDialValue(
  top5SpreadSeconds: number,
  bestLap: number | null,
): number {
  const ratio = bestLap != null && bestLap > 0 ? top5SpreadSeconds / bestLap : null;
  if (ratio == null) return consistencyWord(top5SpreadSeconds, bestLap) === "Tight" ? 8 : 5;
  const scaled = 10 - (ratio / 0.04) * 10;
  return Math.max(1, Math.min(10, Math.round(scaled * 10) / 10));
}

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
    consistency = {
      runLabel: r.runLabel,
      spreadSeconds: r.top5SpreadSeconds,
      word: consistencyWord(r.top5SpreadSeconds, r.bestLap),
    };
    break;
  }

  return { runCount: runs.length, trend, bestRun, lastChange, consistency };
}
