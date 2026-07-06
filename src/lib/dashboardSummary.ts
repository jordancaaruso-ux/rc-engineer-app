/**
 * Dashboard "last 30 days" summary — a reflective, Apple-Health-style momentum +
 * progress panel. Pure aggregation so it can be unit-tested without Prisma:
 * `loadDashboardHomeModel` fetches the rows, maps them to `SummaryRunInput`, and
 * this file buckets them into the current vs prior window, sums the momentum
 * metrics, and picks a trustworthy per-track pace trend.
 *
 * Trust rule (see PRODUCT_NORTH_STAR): lap times are NOT comparable across tracks
 * or classes, so pace is only ever trended within a single track+class — never a
 * mixed-surface line.
 */

/** One completed run reduced to the fields the summary needs. */
export type SummaryRunInput = {
  /** Effective display instant (resolveRunDisplayInstant) — what the window buckets on. */
  effectiveAt: Date;
  /** Count of included laps (lap 0 / excluded already removed). */
  lapCount: number;
  /** Sum of included lap seconds — real recorded wheel time. */
  drivingSeconds: number;
  /** Best included lap, for the pace trend; null when the run has no timed laps. */
  bestLapSeconds: number | null;
  trackId: string | null;
  trackName: string | null;
  /** Race class label (e.g. "17.5 Stock"); part of the pace-comparability key. */
  className: string | null;
};

export type SummaryDelta = { current: number; prior: number };

export type DashboardPaceTrend = {
  trackName: string;
  className: string | null;
  /** How many runs in the current window at this track+class fed the trend. */
  runsCount: number;
  firstBestLap: number;
  lastBestLap: number;
  /** last - first: negative means the driver got FASTER (an improvement). */
  deltaSeconds: number;
  /** Best laps oldest → newest, for the sparkline. */
  spark: number[];
};

export type DashboardSummary = {
  windowDays: number;
  /** False when there are no completed runs in the current window (empty state). */
  hasData: boolean;
  runs: SummaryDelta;
  laps: SummaryDelta;
  drivingSeconds: SummaryDelta;
  /** Distinct local days with a run in the current window. */
  activeDays: number;
  /** Distinct tracks visited in the current window. */
  tracks: number;
  /** Best-lap trend at the most-active track+class, or null when not enough data. */
  pace: DashboardPaceTrend | null;
};

/** Local-day key (YYYY-MM-DD) in the given IANA zone; falls back to UTC on a bad zone. */
function localDayKey(d: Date, timeZone: string): string {
  try {
    // en-CA renders ISO-ish YYYY-MM-DD, which is all we need for a stable day key.
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bucket completed runs into the current window `[now - windowDays, now]` and the
 * immediately prior window of equal length, then summarize.
 */
export function computeDashboardSummary(
  rows: SummaryRunInput[],
  now: Date,
  timeZone: string,
  windowDays = 30
): DashboardSummary {
  const currentStart = new Date(now.getTime() - windowDays * DAY_MS);
  const priorStart = new Date(now.getTime() - 2 * windowDays * DAY_MS);

  const runs: SummaryDelta = { current: 0, prior: 0 };
  const laps: SummaryDelta = { current: 0, prior: 0 };
  const drivingSeconds: SummaryDelta = { current: 0, prior: 0 };
  const activeDayKeys = new Set<string>();
  const trackIds = new Set<string>();

  // Group current-window runs by track+class for the pace trend.
  const paceGroups = new Map<string, { trackName: string; className: string | null; runs: SummaryRunInput[] }>();

  for (const r of rows) {
    const t = r.effectiveAt.getTime();
    const inCurrent = t >= currentStart.getTime() && t <= now.getTime();
    const inPrior = t >= priorStart.getTime() && t < currentStart.getTime();
    if (!inCurrent && !inPrior) continue;

    const bucket = inCurrent ? "current" : "prior";
    runs[bucket] += 1;
    laps[bucket] += r.lapCount;
    drivingSeconds[bucket] += r.drivingSeconds;

    if (inCurrent) {
      activeDayKeys.add(localDayKey(r.effectiveAt, timeZone));
      if (r.trackId) trackIds.add(r.trackId);
      if (r.trackId && r.bestLapSeconds != null && Number.isFinite(r.bestLapSeconds)) {
        const key = `${r.trackId}::${r.className ?? ""}`;
        const g = paceGroups.get(key);
        if (g) {
          g.runs.push(r);
        } else {
          paceGroups.set(key, {
            trackName: r.trackName ?? "your track",
            className: r.className,
            runs: [r],
          });
        }
      }
    }
  }

  const pace = pickPaceTrend(paceGroups);

  return {
    windowDays,
    hasData: runs.current > 0,
    runs,
    laps,
    drivingSeconds,
    activeDays: activeDayKeys.size,
    tracks: trackIds.size,
    pace,
  };
}

/**
 * Pick the track+class with the most timed runs in the window (tie-break: the one
 * whose latest run is most recent) and trend its best lap. Needs ≥2 runs to be a
 * trend at all.
 */
function pickPaceTrend(
  groups: Map<string, { trackName: string; className: string | null; runs: SummaryRunInput[] }>
): DashboardPaceTrend | null {
  let best: { trackName: string; className: string | null; runs: SummaryRunInput[] } | null = null;
  for (const g of groups.values()) {
    if (g.runs.length < 2) continue;
    if (!best) {
      best = g;
      continue;
    }
    if (g.runs.length !== best.runs.length) {
      if (g.runs.length > best.runs.length) best = g;
      continue;
    }
    // Tie on count → prefer the group with the more recent latest run.
    const gLatest = Math.max(...g.runs.map((r) => r.effectiveAt.getTime()));
    const bLatest = Math.max(...best.runs.map((r) => r.effectiveAt.getTime()));
    if (gLatest > bLatest) best = g;
  }
  if (!best) return null;

  const ordered = [...best.runs].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  const spark = ordered.map((r) => r.bestLapSeconds as number);
  const firstBestLap = spark[0];
  const lastBestLap = spark[spark.length - 1];
  return {
    trackName: best.trackName,
    className: best.className,
    runsCount: ordered.length,
    firstBestLap,
    lastBestLap,
    deltaSeconds: lastBestLap - firstBestLap,
    spark,
  };
}

/** Human wheel-time: "2h 14m", "47m", or "3m" (rounds to whole minutes; "0m" when none). */
export function formatDrivingDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes <= 0) return "0m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Delta vs the prior window as a signed count + direction, for the small change
 * chips. `direction` drives gain/loss coloring; "flat" when unchanged.
 */
export function summaryChangeChip(delta: SummaryDelta): {
  diff: number;
  label: string;
  direction: "up" | "down" | "flat";
} {
  const diff = delta.current - delta.prior;
  if (diff === 0) return { diff, label: "same as prior 30d", direction: "flat" };
  const sign = diff > 0 ? "+" : "−";
  return {
    diff,
    label: `${sign}${Math.abs(diff)} vs prior 30d`,
    direction: diff > 0 ? "up" : "down",
  };
}
