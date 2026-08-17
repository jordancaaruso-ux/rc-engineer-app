import {
  computeAnalysisRunMetrics,
  shortRunLabel,
} from "@/lib/analysis/analysisHomeModel";
import {
  resolveRunLocalTimeZone,
  runLocalDayKey,
  runSessionSortInstant,
  type RunGroupZoneOptions,
} from "@/lib/runs/buildRunHistoryGroups";

/**
 * The team day — everyone who ran this session, on one clock.
 *
 * This is the one genuinely new picture in the Sessions rework. Every other
 * surface (a solo day, one teammate's day) is `SessionTrendCard` re-rendered, and
 * both plot *run sequence* on the x-axis. That axis is a lie the moment two people
 * are on it: your run 3 and theirs were not the same twenty minutes, and a track
 * changes more in an hour than most setups do. So the team day is plotted against
 * **time of day** instead, which is the only axis on which two drivers' runs are
 * comparable at all.
 *
 * Prisma-free, like `sessionWorkbenchModel` — it shapes rows the page already has.
 */

/** One run as a point on the day chart. */
export type TeamDayPoint = {
  runId: string;
  /** "Q2", "A1", "R3" — the same short label the sequence charts use. */
  label: string;
  /** Which day's band this point sits in (YYYY-MM-DD, the driver's zone). */
  dayKey: string;
  /** Minutes past local midnight, in the day's own zone. The x-axis. */
  minute: number;
  /** "10:42" — the axis is minutes, but the tooltip must read like a clock. */
  clock: string;
  best: number | null;
  avgTop5: number | null;
  lapCount: number;
};

/** One driver's line, plus their row in the leaderboard beneath it. */
export type TeamDayDriver = {
  userId: string;
  name: string;
  /** Cars they ran today, joined — a driver can switch mid-day. */
  carName: string;
  /** 1-based, ranked by best lap. Drivers with no timed lap sort to the bottom. */
  pos: number;
  best: number | null;
  bestAvgTop5: number | null;
  /** `best − fastest driver's best`. 0 for the leader, null with no timed lap. */
  delta: number | null;
  runCount: number;
  /** Chronological — the chart draws them left to right. */
  points: TeamDayPoint[];
};

/**
 * One day of the session, as its own stretch of clock.
 *
 * A three-day state title is ONE group (events key on `eventId`), and folding its
 * runs onto a single 0–24h clock stacked Saturday morning on top of Friday morning
 * and drew the line backwards overnight — the chart said the car got two seconds
 * slower at lunchtime when it was a different lunchtime. So each day gets its own
 * band, side by side, and time of day still means time of day inside it.
 */
export type TeamDayBand = {
  /** YYYY-MM-DD in the driver's zone — matches `TeamDayPoint.dayKey`. */
  key: string;
  /** "Fri 26 Jun" — the band header. Never shown for a single-day session. */
  label: string;
  /** Axis bounds in minutes past midnight, already padded and rounded to the hour. */
  minMinute: number;
  maxMinute: number;
  runCount: number;
};

export type TeamDayModel = {
  drivers: TeamDayDriver[];
  /** Chronological. One entry for a normal day; one per day of a multi-day meeting. */
  days: TeamDayBand[];
  totalRuns: number;
  /** The fastest lap anyone set today. */
  dayBest: number | null;
};

export type TeamDayRunSource = {
  id: string;
  userId?: string | null;
  carId: string | null;
  carNameSnapshot?: string | null;
  car?: { name: string } | null;
  createdAt: Date | string;
  sortAt?: Date | string | null;
  localTimeZone?: string | null;
  lapTimes: unknown;
  lapSession?: unknown;
  bestLapSeconds?: number | null;
  avgTop5LapSeconds?: number | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
};

/**
 * Minutes past midnight, resolved in the DRIVER's zone — the same rule that
 * decides which day a run belongs to (`resolveRunLocalTimeZone`). Reading a
 * teammate's Sydney test day from Auckland must not slide their runs two hours
 * along the axis; the clock that matters is the one at the track.
 */
function minutesOfDay(run: TeamDayRunSource, zones: RunGroupZoneOptions): number {
  const instant = runSessionSortInstant({
    createdAt: new Date(run.createdAt),
    sortAt: run.sortAt ? new Date(run.sortAt) : null,
  });
  const zone = resolveRunLocalTimeZone(run, zones);
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...(zone ? { timeZone: zone } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // `en-GB` renders midnight as "24" in some ICU versions — fold it back to 0
  // rather than letting one run sit an entire day off the right of the chart.
  return ((hour % 24) * 60 + minute) % (24 * 60);
}

/**
 * "Fri 26 Jun" from a YYYY-MM-DD day key. The key is already in the driver's zone,
 * so it is formatted at UTC noon — anything else re-applies a zone shift to a date
 * that has already had one and can slide the label to the wrong day.
 */
function formatBandLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatClock(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = Math.floor(minute % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function carNamesOf(runs: TeamDayRunSource[]): string {
  const seen: string[] = [];
  for (const run of runs) {
    const name = run.car?.name ?? run.carNameSnapshot ?? null;
    if (name && !seen.includes(name)) seen.push(name);
  }
  if (seen.length === 0) return "Unknown car";
  // Two cars is a real thing (a 2WD and a 4WD in the same meeting); three is
  // rare and a rail row can't hold the list, so it counts instead.
  return seen.length <= 2 ? seen.join(" · ") : `${seen[0]} +${seen.length - 1} more`;
}

/**
 * Build the day chart + leaderboard for one team session group.
 *
 * `memberDisplayByUserId` comes from `loadTeamMemberDisplays`, which is already
 * the page's single source of "what do we call this person" — a second naming
 * rule here is how a driver ends up called two different things on one screen.
 */
export function buildTeamDayModel(
  runs: TeamDayRunSource[],
  opts: {
    memberDisplayByUserId: Record<string, string>;
    zones: RunGroupZoneOptions;
  }
): TeamDayModel | null {
  if (runs.length === 0) return null;

  const byUser = new Map<string, TeamDayRunSource[]>();
  for (const run of runs) {
    const uid = run.userId ?? "unknown";
    const list = byUser.get(uid);
    if (list) list.push(run);
    else byUser.set(uid, [run]);
  }

  const drivers: TeamDayDriver[] = [];
  for (const [userId, driverRuns] of byUser) {
    // Chronological — the line is drawn left to right, and the R1..Rn fallback
    // labels only make sense counted forwards.
    const chronological = [...driverRuns].sort(
      (a, b) =>
        runSessionSortInstant({
          createdAt: new Date(a.createdAt),
          sortAt: a.sortAt ? new Date(a.sortAt) : null,
        }).getTime() -
        runSessionSortInstant({
          createdAt: new Date(b.createdAt),
          sortAt: b.sortAt ? new Date(b.sortAt) : null,
        }).getTime()
    );
    const points: TeamDayPoint[] = chronological.map((run, index) => {
      const metrics = computeAnalysisRunMetrics(run);
      const minute = minutesOfDay(run, opts.zones);
      return {
        runId: run.id,
        label: shortRunLabel(run, index),
        dayKey: runLocalDayKey(run, opts.zones),
        minute,
        clock: formatClock(minute),
        best: metrics.best,
        avgTop5: metrics.avgTop5,
        lapCount: metrics.cleanLapCount,
      };
    });
    const bests = points.map((p) => p.best).filter((b): b is number => b != null);
    const top5s = points.map((p) => p.avgTop5).filter((b): b is number => b != null);
    drivers.push({
      userId,
      name: opts.memberDisplayByUserId[userId] ?? "Unknown driver",
      carName: carNamesOf(chronological),
      pos: 0,
      best: bests.length ? Math.min(...bests) : null,
      bestAvgTop5: top5s.length ? Math.min(...top5s) : null,
      delta: null,
      runCount: driverRuns.length,
      points,
    });
  }

  // Always ranked by best lap. The Best / Avg-top-5 toggle changes what the chart
  // plots, never the order — a list that reshuffles under a chart control makes
  // "who is fastest" a question about which button you last touched.
  drivers.sort((a, b) =>
    a.best == null && b.best == null
      ? a.name.localeCompare(b.name)
      : a.best == null
        ? 1
        : b.best == null
          ? -1
          : a.best - b.best
  );
  const dayBest = drivers[0]?.best ?? null;
  drivers.forEach((driver, index) => {
    driver.pos = index + 1;
    driver.delta = dayBest != null && driver.best != null ? driver.best - dayBest : null;
  });

  // One band per calendar day present, chronological. A meeting that ran Friday
  // evening and all Saturday gets two bands sized by their own hours, not two
  // halves of a shared 24-hour ruler.
  const minutesByDay = new Map<string, number[]>();
  for (const driver of drivers) {
    for (const point of driver.points) {
      const list = minutesByDay.get(point.dayKey);
      if (list) list.push(point.minute);
      else minutesByDay.set(point.dayKey, [point.minute]);
    }
  }
  if (minutesByDay.size === 0) return null;

  const days: TeamDayBand[] = [...minutesByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayMinutes]) => {
      // Snap the axis out to whole hours so the ticks are clock times a human reads,
      // and keep at least a two-hour span or a one-run day draws a single vertical.
      let minMinute = Math.floor(Math.min(...dayMinutes) / 60) * 60;
      let maxMinute = Math.ceil(Math.max(...dayMinutes) / 60) * 60;
      if (maxMinute - minMinute < 120) {
        minMinute = Math.max(0, minMinute - 60);
        maxMinute = Math.min(24 * 60, maxMinute + 60);
      }
      return {
        key,
        label: formatBandLabel(key),
        minMinute,
        maxMinute,
        runCount: dayMinutes.length,
      };
    });

  return {
    drivers,
    days,
    totalRuns: runs.length,
    dayBest,
  };
}
