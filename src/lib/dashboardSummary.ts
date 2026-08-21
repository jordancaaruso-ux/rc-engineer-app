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

/**
 * Longest run of consecutive active days in the window. Lives here rather than in the
 * summary card because the desktop hero's stat strip shows the same figure — two copies
 * would be free to disagree about the same window on the same page.
 */
export function longestStreak(activityByDay: number[]): number {
  let best = 0;
  let cur = 0;
  for (const count of activityByDay) {
    cur = count > 0 ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

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
  /**
   * True when the driver has EVER completed a run, regardless of the window.
   *
   * `hasData` alone was being read as "this driver is new", which it never meant: it is scoped to
   * the rolling window, so a month away from the track made it false for someone with years of
   * history. Measured 2026-08-21 on the production demo account — 178 runs, newest 33 days old —
   * which was being told to "log your first run". The card needs both facts to tell a first-timer
   * apart from a driver having a quiet spell.
   */
  hasEverLogged: boolean;
  /**
   * When the driver was last on track, all-time, ALREADY FORMATTED ("19 Jul"). Null only for a
   * genuine first-timer.
   *
   * A string rather than a `Date` on purpose: this summary travels through a cached read, and a
   * Date that survives a JSON round trip comes back as a string — so a `Date` here would work on a
   * cache miss and throw on a hit. Formatting at the source also keeps the driver's own time zone,
   * which the renderer does not have.
   */
  lastRunLabel: string | null;
  runs: SummaryDelta;
  laps: SummaryDelta;
  drivingSeconds: SummaryDelta;
  /** Distinct local days with a run in the current window. */
  activeDays: number;
  /** Distinct tracks visited in the current window. */
  tracks: number;
  /** Best-lap trend at the most-active track+class, or null when not enough data. */
  pace: DashboardPaceTrend | null;
  /**
   * Best-lap trends for every track+class with ≥2 timed runs in the window,
   * most-active first (`pace` is always the first entry). Feeds the summary
   * card's per-track pace face.
   */
  paceByTrack: DashboardPaceTrend[];
  /**
   * Runs per local calendar day across the current window, oldest → newest
   * (length = windowDays; today is the last entry). Feeds the activity face.
   */
  activityByDay: number[];
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

/** "19 Jul" in the driver's own time zone, for the quiet-spell line. */
function formatLastOut(d: Date | null, timeZone: string): string | null {
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d);
  }
}

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

  // Map each of the window's local calendar days to its slot, oldest → newest.
  // (DST can make two offsets share a key; last write wins, which is harmless.)
  const dayIndexByKey = new Map<string, number>();
  for (let i = 0; i < windowDays; i++) {
    const day = new Date(now.getTime() - (windowDays - 1 - i) * DAY_MS);
    dayIndexByKey.set(localDayKey(day, timeZone), i);
  }
  const activityByDay: number[] = new Array(windowDays).fill(0);

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
      const dayKey = localDayKey(r.effectiveAt, timeZone);
      activeDayKeys.add(dayKey);
      const dayIndex = dayIndexByKey.get(dayKey);
      if (dayIndex != null) activityByDay[dayIndex] += 1;
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

  const paceByTrack = rankPaceTrends(paceGroups);

  return {
    windowDays,
    hasData: runs.current > 0,
    // Computed from the same `rows` the windows are cut from — that argument is the full completed
    // run history, not a pre-filtered slice, so this needs no extra query.
    hasEverLogged: rows.length > 0,
    lastRunLabel: formatLastOut(
      rows.reduce<Date | null>(
        (newest, r) => (newest === null || r.effectiveAt > newest ? r.effectiveAt : newest),
        null,
      ),
      timeZone,
    ),
    runs,
    laps,
    drivingSeconds,
    activeDays: activeDayKeys.size,
    tracks: trackIds.size,
    pace: paceByTrack[0] ?? null,
    paceByTrack,
    activityByDay,
  };
}

/**
 * Trend the best lap of every track+class with ≥2 timed runs in the window,
 * ranked by run count (tie-break: the group whose latest run is most recent).
 * The first entry is the headline `pace` trend.
 */
function rankPaceTrends(
  groups: Map<string, { trackName: string; className: string | null; runs: SummaryRunInput[] }>
): DashboardPaceTrend[] {
  const ranked = [...groups.values()]
    .filter((g) => g.runs.length >= 2)
    .map((g) => {
      const ordered = [...g.runs].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
      return { group: g, ordered, latest: ordered[ordered.length - 1].effectiveAt.getTime() };
    })
    .sort((a, b) => b.ordered.length - a.ordered.length || b.latest - a.latest);

  return ranked.map(({ group, ordered }) => {
    const spark = ordered.map((r) => r.bestLapSeconds as number);
    const firstBestLap = spark[0];
    const lastBestLap = spark[spark.length - 1];
    return {
      trackName: group.trackName,
      className: group.className,
      runsCount: ordered.length,
      firstBestLap,
      lastBestLap,
      deltaSeconds: lastBestLap - firstBestLap,
      spark,
    };
  });
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
