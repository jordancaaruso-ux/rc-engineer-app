/**
 * Track-day verdict math — the computed-only "three instruments" behind the
 * dashboard's day-verdict card (docs/DASHBOARD_NORTH_STAR.md, v2 2026-07-19):
 * pace trend across today's runs, whether the last setup change helped, and how
 * the car felt across the day. Pure functions, no AI, no DB — dashboardServer
 * builds the inputs from today's runs.
 *
 * The consistency helpers below no longer serve this card (see `handling`); they
 * stay here because the DESKTOP hero's second dial still reads them, and moving
 * them would touch a surface this change deliberately leaves alone.
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
  /**
   * Where the run came in the day, set ONLY when that is what `runLabel` says — a day
   * whose sessions all share one name is named by position instead (`resolveDayRunNames`).
   * The card reads it to write "run 3 of 5" rather than repeating a word that named
   * every run today.
   */
  runPosition?: number | null;
  bestLap: number | null;
  avgTop5: number | null;
  /** The driver's own 1–10 rating from "Run complete"; null on drafts and legacy runs. */
  carRating: number | null;
  changedRows: VerdictChangedRow[];
};

export type ConsistencyWord = "Tight" | "Fair" | "Scrappy";

/**
 * Judge a top-5 spread relative to lap length, so 5-second laps and 12-second laps
 * get the same bar: within 1% of the best lap is tight, within 2.5% fair, beyond
 * that scrappy. Falls back to absolute seconds when there is no best lap to scale by.
 *
 * DESKTOP HERO ONLY since 2026-08-15. The phone's verdict card used to show this word
 * and now shows `handling` instead; the hero's second dial is the last reader.
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
 * The spread as the percentage the hero dial prints in its middle: 100 minus the spread's
 * share of lap time. A 0.084 s spread on a 15.04 s lap is 0.56% of the lap, so 99.4%.
 *
 * Null when there is no best lap to scale by — a percentage of nothing is not a number,
 * and the dial shows an en-dash rather than inventing one.
 *
 * Founder call 2026-08-10, with the flattening flagged and accepted: because the spread
 * is a small share of a lap, every run lands between roughly 97% and 100%, so this number
 * separates a tight day from a scrappy one by ~2.5 points. The WORD carries the loud
 * signal and the arc keeps the wider 0–10 scale below; this is the readable measurement,
 * not the at-a-glance one.
 */
export function consistencyPercent(
  top5SpreadSeconds: number,
  bestLap: number | null,
): number | null {
  if (bestLap == null || bestLap <= 0) return null;
  const pct = 100 - (top5SpreadSeconds / bestLap) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/**
 * The same spread as a 0–10 magnitude, for `RatingDial` in verdict mode. Anchored on
 * the word cutoffs above: a tight run (≤1%) lands at 7.5+, the fair band spans roughly
 * 3.75–7.5, and scrappy falls below. It is the arc length and colour only — the dial
 * prints the percentage, never this number.
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
    /**
     * Where the latest run sits against the rest of today. Null until a THIRD comparable
     * run exists, because with two the only possible comparison is against run one — see
     * {@link medianOfEarlier} for why that anchor was retired.
     */
    direction: "faster" | "slower" | "steady" | null;
    /** Latest comparable run minus the median of the earlier ones (negative = faster); null alongside a null direction. */
    delta: number | null;
    metric: "avg" | "best";
    /** Chronological per-run metric values — the sparkline. */
    spark: number[];
  };
  /** The run holding today's best lap. */
  bestRun: null | {
    runLabel: string;
    runPosition: number | null;
    bestLap: number | null;
    avgTop5: number | null;
  };
  /** The most recent run that changed setup, and what that change did to pace. */
  lastChange: null | {
    runLabel: string;
    runPosition: number | null;
    rows: VerdictChangedRow[];
    /** Metric delta vs the nearest earlier run today with the same metric; null when incomparable. */
    delta: number | null;
    metric: "avg" | "best";
    verdict: "helped" | "hurt" | "unclear";
  };
  /**
   * How the car felt across today — the driver's own ratings, in the order they
   * were given. Null until one run today carries a rating.
   *
   * Founder call 2026-08-15: this replaced the top-5-spread "Consistency" row on the
   * phone card. That number measured the five FASTEST laps, so a run with five clean
   * laps and fifteen messy ones scored "Tight" — and it needed ≥5 imported laps to say
   * anything at all. A rating is required to mark a run complete (the runs API 400s
   * without one), so this row still speaks on a club night with no timing import,
   * where the old one went blank.
   */
  handling: null | {
    /** The latest rated run's rating — what the dial points at. */
    rating: number;
    runLabel: string;
    runPosition: number | null;
    /** Today's ratings, chronological, one per rated run. */
    arc: number[];
    /**
     * How the car went across today. Null with fewer than three ratings — see
     * {@link medianOfEarlier}.
     *
     * "flat" means every run today carried the SAME number, and nothing else does: it is
     * the only state the card is allowed to call "same all day", because that sentence
     * was the founder report. A day that moved and came back is "swinging"; a day that
     * moved early and then settled is "holding". Both used to print "same all day".
     */
    direction: null | "improving" | "fading" | "flat" | "holding" | "swinging";
  };
};

/** Deltas inside ±this many seconds read as noise, not a direction. */
const STEADY_BAND_SECONDS = 0.05;

/**
 * A rating has to move MORE THAN a point to count as a move. One point either way stays
 * inside a single rating band (Bad 1–3, Workable 4–6, Good 7–8), so it is a wobble in how
 * the same car got described, not the car changing — without this, a day of 6 → 5 → 6 → 5
 * flipped between "coming to you" and "going away" every run. The band sits at 1.5 rather
 * than 2 because the anchor is a median, which lands on a half whenever an even number of
 * earlier runs feeds it, and a real climb of 5 → 6 → 7 has to survive.
 */
const RATING_MOVE_BAND = 1.5;

/** A rise and a fall of this many rating points each makes the day "up and down". */
const RATING_SWING_POINTS = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The anchor every "which way is it going" row on this card measures against: the MEDIAN
 * of today's earlier runs, not the first one.
 *
 * Founder call 2026-08-25, after a day that fluctuated read as "same all day". Run one is
 * the worst anchor available and it was anchoring everything: it is the worst run of the
 * day by design (cold tyres, green track, a guess at a setup), so "trending faster" by run
 * four was close to automatic and therefore said nothing; it is a single run, so one
 * session ruined by traffic set the reference for the whole day's verdict; and it goes
 * stale, leaving run eight measured against a car that stopped existing hours ago. On pace
 * it is worse still, because the track comes to everyone as rubber goes down, and the card
 * was crediting the setup for it.
 *
 * A median takes every earlier run into account and cannot be dragged by one outlier, and
 * it works on a three-run day — which is why it was chosen over comparing halves of the
 * day, which needs four runs before it can speak at all.
 *
 * Returns null with fewer than two earlier values: comparing run two to run one IS the
 * anchor this replaced, so the card stays quiet until a third run lands.
 */
function medianOfEarlier(series: number[]): number | null {
  const earlier = series.slice(0, -1);
  return earlier.length >= 2 ? median(earlier) : null;
}

/**
 * Did the day bounce? True when it rose by {@link RATING_SWING_POINTS} at some point AND
 * fell by that much at another, in either order — a run-up measured from the running low,
 * a drawdown measured from the running high.
 *
 * This deliberately does NOT require the day to end where it started. A day of 3 → 8 → 3 →
 * 8 ends five points up and is still all over the place; "coming to you" there would be a
 * reading of the last two runs rather than of the day.
 */
function bounced(arc: number[]): boolean {
  let low = arc[0];
  let high = arc[0];
  let runUp = 0;
  let drawdown = 0;
  for (const v of arc) {
    low = Math.min(low, v);
    high = Math.max(high, v);
    runUp = Math.max(runUp, v - low);
    drawdown = Math.max(drawdown, high - v);
  }
  return runUp >= RATING_SWING_POINTS && drawdown >= RATING_SWING_POINTS;
}

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
    // Two runs still draw a sparkline and still name the day's best — they just get no
    // verdict, because the only comparison available is the one this card stopped making.
    const anchor = medianOfEarlier(series);
    const delta = anchor == null ? null : series[series.length - 1] - anchor;
    trend = {
      direction:
        delta == null
          ? null
          : delta <= -STEADY_BAND_SECONDS
            ? "faster"
            : delta >= STEADY_BAND_SECONDS
              ? "slower"
              : "steady",
      delta,
      metric,
      spark: series,
    };
  }

  let bestRun: TodayVerdict["bestRun"] = null;
  for (const r of runs) {
    if (r.bestLap != null && (bestRun?.bestLap == null || r.bestLap < bestRun.bestLap)) {
      bestRun = {
        runLabel: r.runLabel,
        runPosition: r.runPosition ?? null,
        bestLap: r.bestLap,
        avgTop5: r.avgTop5,
      };
    }
  }
  if (!bestRun) {
    // No laps anywhere today — still name the latest run so the card has a subject.
    const last = runs[runs.length - 1];
    bestRun = {
      runLabel: last.runLabel,
      runPosition: last.runPosition ?? null,
      bestLap: null,
      avgTop5: last.avgTop5,
    };
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
      runPosition: changed.runPosition ?? null,
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

  const ratedRuns = runs.filter(
    (r): r is VerdictRunInput & { carRating: number } => r.carRating != null,
  );
  let handling: TodayVerdict["handling"] = null;
  if (ratedRuns.length > 0) {
    const arc = ratedRuns.map((r) => r.carRating);
    const latest = ratedRuns[ratedRuns.length - 1];
    const anchor = medianOfEarlier(arc);
    const swing = anchor == null ? 0 : arc[arc.length - 1] - anchor;
    handling = {
      rating: latest.carRating,
      runLabel: latest.runLabel,
      runPosition: latest.runPosition ?? null,
      arc,
      // Bounce first, then direction against the median of the earlier runs — the same
      // convention the pace trend uses. "Same all day" is now reserved for a day that
      // actually held still: one that wandered and came back says so instead.
      direction:
        anchor == null
          ? null
          : Math.min(...arc) === Math.max(...arc)
            ? "flat"
            : bounced(arc)
              ? "swinging"
              : swing >= RATING_MOVE_BAND
                ? "improving"
                : swing <= -RATING_MOVE_BAND
                  ? "fading"
                  : "holding",
    };
  }

  return { runCount: runs.length, trend, bestRun, lastChange, handling };
}
