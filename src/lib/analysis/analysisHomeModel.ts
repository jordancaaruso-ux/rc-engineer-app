import {
  computeConsistencyFromCV,
  computeMistakeLaps,
  getAverageTopN,
  getIncludedLaps,
  percentileSorted,
  primaryLapRowsFromRun,
  roundConsistencyScore,
  analyzeLapRows,
  MIN_LAPS_FOR_MISTAKES,
  MISTAKE_IQR_MULTIPLIER,
  MISTAKE_MIN_ABSOLUTE_SEC,
} from "@/lib/lapAnalysis";
import { formatRunSessionDisplay, resolveDayRunNames, runSessionName } from "@/lib/runSession";
import { calendarYmdInTimeZone } from "@/lib/formatDate";
import type { RunTireIndicator } from "@/lib/runs/tireSetChange";
import { setupChangedRowsSincePrevious } from "@/lib/setupCompare/changedSincePrevious";
import { isExcludedSetupChangeKey } from "@/lib/setupCompare/setupChangeNoise";

/**
 * Analysis debrief home model — pure types + shaping helpers shared by the
 * server loader (`loadAnalysisHomeModel`) and the `/analysis` client cards.
 * Keep this file Prisma-free so `npx tsx src/lib/analysis/analysisHomeModel.test.ts`
 * runs offline.
 */

/** Per-run lap metrics for the trend chart + accordion (included laps only). */
export type AnalysisRunMetrics = {
  best: number | null;
  avgTop5: number | null;
  avgTop10: number | null;
  median: number | null;
  cleanLapCount: number;
  /** RC-style consistency (100 − CV), higher = steadier; null when too few laps. */
  consistencyScore: number | null;
  /** Count of mistake laps (IQR outliers); null when the run isn't mistake-eligible. */
  mistakeCount: number | null;
};

/**
 * Chassis-setup change vs the previous run on the same car — the wrench-row
 * marker on the trend chart. Present (non-null) only when at least one setup
 * field differed; tires / battery / additive are not setup-sheet fields and are
 * excluded (they live on the run itself and have their own tire row).
 */
export type RunSetupChangeIndicator = {
  /** Human labels of the fields that changed, e.g. ["Camber (Front)", "Toe (Rear)"]. */
  changedFieldLabels: string[];
};

/**
 * Lap distribution for one run — the box-and-whisker ("Spread") view of the
 * trend chart's Pace face. Quartiles over included laps.
 *
 * The whiskers are deliberately asymmetric rather than textbook Tukey: in RC a
 * fast tail is performance and a slow tail is a mistake, so the bottom whisker
 * always reaches the best lap (never clipped as an "outlier") while the top
 * whisker stops at the slowest lap that isn't a mistake. `mistakes` uses the
 * same rule as the Mistakes face, so "bad lap" means one thing across the card.
 */
export type AnalysisRunDistribution = {
  /** Fastest included lap — the bottom whisker, never clipped as an outlier. */
  best: number;
  p25: number;
  median: number;
  p75: number;
  /**
   * Slowest included lap that is not a mistake lap — the top whisker.
   *
   * NOT guaranteed to be ≥ `p75`. Quartiles span every included lap (mistakes
   * included) so the median here is the same number as the trend chart's Median
   * series; when a run's whole top quartile is mistakes, Q3 lands above the
   * slowest clean lap and there is simply no upper whisker to draw. Rare —
   * 2 of 146 mistake-eligible runs on the demo season — but real.
   */
  slowestClean: number;
  /** Mistake lap times (same rule as the Mistakes face), plotted as dots. */
  mistakes: number[];
};

/**
 * A run needs enough laps for the *whole* whisker rule to work, not merely enough
 * for quartiles to compute. Below `MIN_LAPS_FOR_MISTAKES` no lap can be
 * classified as a mistake, so a short run's crash lap would sit on its top
 * whisker while an identical lap in a longer run plots as a dot — the same
 * event drawn two different ways depending on stint length. Tying both to one
 * floor removes the special case, and Q1/Q3 off five samples was never worth
 * drawing anyway.
 */
export const MIN_LAPS_FOR_DISTRIBUTION = MIN_LAPS_FOR_MISTAKES;

export type AnalysisTrendRun = {
  id: string;
  carId: string | null;
  carName: string;
  /** Short x-axis label, e.g. "Q1", "A2", "R3". */
  shortLabel: string;
  /**
   * The session's full name — "Qualifying 2", "Run 4". For the readout strip
   * above the plot, which is full-width and can hold it; the axis ticks share
   * one row between every run in the session and keep `shortLabel`.
   */
  sessionName: string;
  /**
   * Clock time the run was logged — "2:41 PM" — in the zone it was logged in
   * (`resolveRunLocalTimeZone`), so a trip away reads on the track's clock rather
   * than the reader's. Formatted server-side for the reason every other run time in
   * the app is: the card is a client component and formatting there would hydrate
   * against the browser's zone.
   */
  timeLabel: string | null;
  createdAtIso: string;
  metrics: AnalysisRunMetrics;
  /** Lap distribution for the spread view; null when too few included laps. */
  distribution: AnalysisRunDistribution | null;
  /** Tire set + wear for this run; null when no set was logged. */
  tireIndicator: RunTireIndicator | null;
  /** Setup fields changed vs the previous run on this car; null when none / no baseline. */
  setupChange: RunSetupChangeIndicator | null;
  /**
   * The driver's own 1–10 verdict on the car for this run, and the air temperature it
   * ran in — the two facts the readout strip prints beside the lap times (2026-08-26).
   *
   * They are on the run, not on the plot. Four grey lines plus a rating line is two
   * scales in one frame, where the second one's height means nothing in seconds and can
   * only ever be read for shape; the version of this that drew them was built, looked at
   * and dropped in favour of the figures alone. What the strip gives instead is the pair
   * on one glance — "18.55, and you called it a 5, and it was 27°" — which is the whole
   * question this card gets asked on a hot afternoon.
   *
   * `carRating` is null outside 1–10 so a legacy 0 or a stray 11 can never colour a band;
   * `airTempC` is the stored Celsius float, rounded where it is drawn, never here.
   */
  carRating: number | null;
  airTempC: number | null;
};

export type AnalysisCarOption = { carId: string | null; carName: string };

export type AnalysisTrendModel = {
  /**
   * "Winter Series R3" (event) or "Ironbark Raceway · 19 Aug 2026" (day) — DRAWN on the card
   * since 2026-08-20, under the title. It was built and then only handed to the chart's
   * screen-reader description, so the picture named neither the track nor the day on screen.
   * Built by `trendScopeLabel`, which carries the rules.
   */
  scopeLabel: string;
  scopeKind: "event" | "day";
  /** Chronological (oldest → newest), all cars; lap-less runs omitted. */
  runs: AnalysisTrendRun[];
  carOptions: AnalysisCarOption[];
  defaultCarId: string | null;
};

export type AnalysisRecentRun = {
  id: string;
  /** Null → no wrench; the setup modal needs a car to resolve sheet + previous run. */
  carId: string | null;
  /** "Qualifying · Q2 · A800 RR" */
  title: string;
  /**
   * "Ironbark Raceway · 3 Jul, 4:20 PM" — formatted server-side by `recentRunSubLabel`, which
   * carries why the clean-lap count that used to sit here gave up the slot to the track.
   */
  subLabel: string;
  metrics: AnalysisRunMetrics;
  /** Best-lap delta vs the previous run with the same car + track (null when none). */
  bestDeltaVsPrev: number | null;
  /** Best lap equals the user's fastest at this car + track combo. */
  isTrackCarPb: boolean;
  /** Tire set + wear for this run; null when no set was logged. */
  tireIndicator: RunTireIndicator | null;
};

/**
 * One driver on the "Out with you" card — the people who were at the same meeting, or at the
 * same track on the same day, and where they got to.
 *
 * Founder call (2026-08-19), after two team-scoped drafts were rejected: teams are the wrong
 * denominator, and the timing-import field is the wrong source because it only exists when the
 * import was a multi-driver race result — a practice session is one Speedhive link with one
 * driver in it, so that version of this card would be blank on exactly the days you are testing.
 * This reads other drivers' OWN logged runs instead.
 *
 * The exchange rate is coverage: this can only ever show people who use the app. Eighteen
 * entrants at a club round might be two rows. `driverCount` exists so the card can say so.
 */
export type OutWithYouDriver = {
  userId: string;
  /** What to print. "You" on the viewer's own row — never an email; see `loadOutWithYou`. */
  name: string;
  isViewer: boolean;
  /** Their best lap in this scope. Never null — a driver with no timed lap is not a row. */
  bestLapSeconds: number;
  /**
   * `theirs − yours`, so **positive = slower than you**, matching the app-wide delta convention
   * (cell − anchor, and you are the anchor). Null on the viewer's own row.
   */
  deltaSeconds: number | null;
  /**
   * A team BOTH of you are in, and therefore the one place the viewer may already read this
   * driver's runs — `/runs/history?teamId=…&driverIds=…`. Null on the viewer's own row, and null
   * for anyone who is only a co-presence match, which is most of them (2026-08-20).
   *
   * This is the whole reason the row can be a link. The card's scope is who was at the track, not
   * who is on your team, so a door built on the card's own scope would promise a history the
   * viewer has no right to. Built on the shared team instead, the link opens a page that was
   * already theirs to open — the row is a shortcut, never a grant. `/runs/history` re-checks
   * membership on arrival regardless; this only decides whether to draw the door.
   */
  sharedTeamId: string | null;
};

export type OutWithYouModel = {
  /** The meeting's name, or "TFTR · Sunday 19 July" for a track day with no event row. */
  scopeLabel: string;
  /**
   * True when the grouping is an event. An event is exact — everyone on it entered the same
   * meeting. The day fallback is a guess: one venue can run a morning club practice and an
   * evening race, and two people there may never have shared the track. The card shows which
   * kind it is rather than presenting them identically.
   */
  isEvent: boolean;
  /** Sorted by best lap, then windowed around the viewer. Always contains the viewer. */
  drivers: OutWithYouDriver[];
  /** Every driver this card could show in scope, including the viewer, before the window. */
  driverCount: number;
};

/** Rows on the card. Odd, so "two above and two below" is symmetrical around the viewer. */
export const OUT_WITH_YOU_ROWS = 5;

/**
 * One teammate on the **Last out** band — the lower half of the Teammates card, added
 * 2026-08-20 on founder request: *"the list below should be expansive, every teammate you have."*
 *
 * This half is scoped by `TeamMembership` and nothing else, which is the opposite of the meeting
 * half above it and is the whole point of having both. The meeting half answers *how am I going
 * against the people here*; this answers *who on my team has been out, and when* — everyone, at
 * any track, going back as far as they have run. A teammate who has never shared a run is still a
 * row (`lastRunAtIso: null`): the band claims to be every teammate, so silently dropping the
 * quiet ones would make it a different list than the one it says it is.
 *
 * Because membership is mutual and retroactive, every row here is a door the viewer already had —
 * `/runs/history?teamId=…&driverIds=…`. None of them needs the meeting half's `sharedTeamId` test.
 */
export type TeammateLastOut = {
  userId: string;
  /** What to print. Roster rules apply here (see `loadTeammatesLastOut`), and never "You". */
  name: string;
  /** A team you are both in — the row's door. Oldest membership wins when there are several. */
  teamId: string;
  /** Their last shared run; null when they have never shared one. */
  lastRunAtIso: string | null;
  /**
   * Server-rendered label for that timestamp ("3 days ago", "No shared runs"). `RelativeTime`
   * replaces it on the client after mount and then re-ticks; this is what SSR paints, so it has
   * to be a real answer rather than a dash — the band gets read on a phone that just woke up.
   */
  lastRunLabel: string;
  /** Best lap of that run. Null when the run carried no timed lap. */
  bestLapSeconds: number | null;
  /**
   * Where that run was. DRAWN next to the lap, and load-bearing rather than decorative: this band
   * spans every track, so a bare lap time beside a name invites a comparison between two
   * different circuits that means nothing. The track is what makes the number readable.
   */
  trackName: string | null;
  /** Ran inside `TEAMMATE_LIVE_WINDOW_MS` — the pip. Stale by at most the cache window. */
  isLive: boolean;
};

/** Rows the Last-out band draws before the fold. The rest sit behind "Show all N". */
export const TEAMMATES_LAST_OUT_VISIBLE = 5;

/** How recent a run has to be to light the pip. Roughly one heat cycle at a club round. */
export const TEAMMATE_LIVE_WINDOW_MS = 20 * 60 * 1000;

/**
 * Newest run first, with teammates who have shared nothing at the end.
 *
 * That tail is sorted by name rather than left in query order, so the quiet half of a big team
 * does not reshuffle between loads — a list that reorders under you while you read it looks like
 * it is reporting a change.
 */
export function sortTeammatesByLastOut<T extends { lastRunAtIso: string | null; name: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (a.lastRunAtIso && b.lastRunAtIso) return b.lastRunAtIso.localeCompare(a.lastRunAtIso);
    if (a.lastRunAtIso) return -1;
    if (b.lastRunAtIso) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The whole Teammates card: the meeting you shared with other drivers, then your team.
 *
 * Two halves with two different scopes, deliberately not reconciled. The meeting half is
 * **co-presence** — whoever was at that event, or at that track that day, teammate or stranger.
 * The Last-out half is **membership** — your team, wherever they were. Either can be empty: a
 * solo driver at a club round gets only the meeting half, and a team whose members never race
 * together gets only the lower one. The card is dropped only when both are.
 */
export type TeammatesModel = {
  /** The co-presence half; null when no recent meeting of yours had another driver on it. */
  meeting: OutWithYouModel | null;
  /** Every teammate, newest run first. Empty when the driver is on no teams. */
  lastOut: TeammateLastOut[];
};

/**
 * The rows nearest the viewer, keeping the viewer in the middle where the list is long enough.
 *
 * Anchored on the viewer rather than the leader on purpose: a list you always lead, or always
 * trail, is a list you stop reading — and the two people either side of you are the ones you are
 * actually racing. Clamps at both ends, so a viewer who IS fastest still gets a full-length card.
 */
export function windowAroundViewer<T extends { isViewer: boolean }>(
  rows: T[],
  max: number = OUT_WITH_YOU_ROWS
): T[] {
  if (rows.length <= max) return rows;
  const viewerIndex = rows.findIndex((row) => row.isViewer);
  if (viewerIndex < 0) return rows.slice(0, max);
  const half = Math.floor(max / 2);
  const start = Math.min(Math.max(0, viewerIndex - half), rows.length - max);
  return rows.slice(start, start + max);
}

/**
 * The page's non-outing half.
 *
 * `trend` and `recentRuns` came off on 2026-08-25: the chart is now built from the
 * SAME day the outing block lists (`loadAnalysisOuting`), and the recent-runs list
 * is that block. See the loader for why the event-scoped trend went with them.
 */
export type AnalysisHomeModel = {
  /**
   * Every run the driver has logged — RUNS, not session groups (Sessions groups
   * them by day / meeting, so the two numbers differ). The Sessions door quotes it:
   * "148 runs" is a reason to tap, "all sessions" on its own is an abstraction.
   */
  totalRunCount: number;
  /**
   * Whether the driver belongs to any team. Gates the Sessions door's mention of team
   * sessions: `/runs/history` carries a My sessions / <Team> scope switcher, but it only
   * offers teams to members — promising them to a solo driver advertises a room they
   * cannot open.
   */
  hasTeam: boolean;
  /**
   * The Teammates card — the meeting you shared with other drivers, and every teammate by how
   * recently they last ran. Null when BOTH halves are empty (no runs, nobody in scope, no teams),
   * and the card is then dropped rather than drawn: an empty state reading "no one else here logs
   * runs" is a card about the app's adoption, not about the driver.
   *
   * This replaced the video card on 2026-08-19. Video was a straight duplicate — `/tools` carries
   * a full Video band over the same job list — so a page about reviewing the day had a toolbox
   * stapled to it for the second time.
   */
  teammates: TeammatesModel | null;
};

/** Median of included lap times (seconds); null when empty. */
export function medianOf(times: number[]): number | null {
  const finite = times.filter((t) => Number.isFinite(t));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Metrics for one run. Prefers the materialized `bestLapSeconds` /
 * `avgTop5LapSeconds` columns (matches Sessions list behaviour) and falls back
 * to recomputing from the lap JSON for legacy rows; top-10 and median are
 * always computed from included laps.
 */
export function computeAnalysisRunMetrics(run: {
  lapTimes: unknown;
  lapSession?: unknown;
  bestLapSeconds?: number | null;
  avgTop5LapSeconds?: number | null;
}): AnalysisRunMetrics {
  const rows = primaryLapRowsFromRun(run);
  const included = getIncludedLaps(rows);
  const times = included.map((l) => l.lapTimeSeconds);
  const computedBest = times.length > 0 ? Math.min(...times) : null;

  const analysis = analyzeLapRows(rows);
  const cvPercent =
    analysis.averageLap != null && analysis.averageLap > 0 && analysis.consistencyStdDev != null
      ? (analysis.consistencyStdDev / analysis.averageLap) * 100
      : null;
  const consistencyScore =
    cvPercent != null ? roundConsistencyScore(computeConsistencyFromCV(cvPercent)) : null;
  const mistakes = computeMistakeLaps(rows);

  return {
    best: run.bestLapSeconds ?? computedBest,
    avgTop5: run.avgTop5LapSeconds ?? getAverageTopN(rows, 5),
    avgTop10: getAverageTopN(rows, 10),
    median: medianOf(times),
    cleanLapCount: included.length,
    consistencyScore,
    mistakeCount: mistakes.eligible ? mistakes.mistakeCount : null,
  };
}

/**
 * Lap distribution for one run's spread view — see `AnalysisRunDistribution`.
 * Null below `MIN_LAPS_FOR_DISTRIBUTION` included laps, which is the same floor
 * mistake detection uses, so every run that draws a box also gets the outlier
 * rule applied to it. Clean/mistake laps split on the threshold rather than on
 * membership of `computeMistakeLaps`'s list, so duplicate lap times are
 * classified independently.
 */
export function computeLapDistribution(run: {
  lapTimes: unknown;
  lapSession?: unknown;
}): AnalysisRunDistribution | null {
  const included = getIncludedLaps(primaryLapRowsFromRun(run));
  const sorted = included
    .map((lap) => lap.lapTimeSeconds)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (sorted.length < MIN_LAPS_FOR_DISTRIBUTION) return null;

  const median = medianOf(sorted)!;
  const p25 = percentileSorted(sorted, 0.25);
  const p75 = percentileSorted(sorted, 0.75);
  const iqr = Math.max(0, p75 - p25);
  const threshold = Math.max(MISTAKE_MIN_ABSOLUTE_SEC, MISTAKE_IQR_MULTIPLIER * iqr);

  const mistakes = sorted.filter((t) => t - median > threshold);
  // Every lap being a "mistake" is impossible (they can't all be above their own
  // median), but fall back to the full set rather than trusting that here.
  const clean = sorted.filter((t) => t - median <= threshold);
  const cleanOrAll = clean.length > 0 ? clean : sorted;

  return {
    best: sorted[0],
    p25,
    median,
    p75,
    slowestClean: cleanOrAll[cleanOrAll.length - 1],
    mistakes,
  };
}

/**
 * Short x-axis label: meeting session code ("Q1", "A2") wins; a short session
 * label is used verbatim; otherwise "R{order}" from chronological position.
 */
export function shortRunLabel(
  run: { meetingSessionCode?: string | null; sessionLabel?: string | null },
  chronologicalIndex: number
): string {
  const code = run.meetingSessionCode?.trim();
  if (code) return code;
  const label = run.sessionLabel?.trim();
  if (label && label.length <= 8) return label;
  return `R${chronologicalIndex + 1}`;
}

/** One run's place in its scope, and the name that place earned it. */
export type ScopedRunName = {
  /** What to print for this run. */
  label: string;
  /** Set only when `label` IS the position — the phone card turns it into "run 3 of 5". */
  position: number | null;
  /** 1-based position within the scope, counted per car. Also the axis tick's index + 1. */
  runNumber: number;
};

/**
 * Name every run in ONE scope (a day, an event) so that no two of them read the same.
 *
 * A run is named by its session TYPE and nothing stores a session number, so a day of
 * five practice sessions named all five of them "Practice" — see `resolveDayRunNames`
 * for why the repeat becomes a position rather than an invented "Practice 3".
 *
 * The number counts per CAR, matching the axis fallback, so swapping cars mid-day reads
 * Run 1..n on both rather than one of them jumping. It counts EVERY run in the scope,
 * including the ones with no laps: the chart drops those points but the rail still lists
 * them, and two independent counts would have the same run reading "Run 3" in the rail and
 * "Run 2" in the tooltip beside it. The axis then shows a gap where a run has no laps,
 * which is the honest drawing — that run has nothing to plot.
 *
 * @param chronological runs oldest-first.
 */
export function nameScopedRuns<
  T extends {
    id: string;
    carId?: string | null;
    sessionType?: string | null;
    meetingSessionType?: string | null;
    meetingSessionCode?: string | null;
    sessionLabel?: string | null;
  },
>(chronological: readonly T[]): Map<string, ScopedRunName> {
  const perCarCount = new Map<string, number>();
  const numbered = chronological.map((run) => {
    const carKey = run.carId ?? "__none__";
    const runNumber = (perCarCount.get(carKey) ?? 0) + 1;
    perCarCount.set(carKey, runNumber);
    return { id: run.id, runNumber, name: runSessionName(run, { dayRunNumber: runNumber }) };
  });
  const resolved = resolveDayRunNames(
    numbered.map(({ name, runNumber }) => ({ name, dayRunNumber: runNumber }))
  );
  return new Map(
    numbered.map(({ id, runNumber }, i) => [
      id,
      { label: resolved[i].label, position: resolved[i].position, runNumber },
    ])
  );
}

const SESSION_TYPE_FALLBACK_LABELS: Record<string, string> = {
  TESTING: "Testing",
  PRACTICE: "Practice",
  RACE_MEETING: "Race",
};

/** Accordion row title: session display (or session-type fallback) + car name. */
export function runRowTitle(run: {
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  carName?: string | null;
}): string {
  const session = formatRunSessionDisplay(run);
  const sessionPart =
    session !== "—" ? session : SESSION_TYPE_FALLBACK_LABELS[run.sessionType] ?? "Run";
  const car = run.carName?.trim();
  return car ? `${sessionPart} · ${car}` : sessionPart;
}

export type TrendScope =
  | { kind: "event"; eventId: string }
  | { kind: "day"; ymd: string };

/**
 * Chart scope: the latest run's event when it has one, otherwise that run's
 * calendar day in the display timezone. (An active event weekend therefore
 * charts the whole event; a plain test day charts that day; midweek you see
 * your most recent outing rather than an empty chart.)
 */
export function resolveTrendScope(
  latestRun: { eventId: string | null; createdAt: Date | string },
  timeZone: string
): TrendScope {
  if (latestRun.eventId) return { kind: "event", eventId: latestRun.eventId };
  return { kind: "day", ymd: calendarYmdInTimeZone(latestRun.createdAt, timeZone) };
}

export function runMatchesScope(
  run: { eventId: string | null; createdAt: Date | string },
  scope: TrendScope,
  timeZone: string
): boolean {
  if (scope.kind === "event") return run.eventId === scope.eventId;
  return calendarYmdInTimeZone(run.createdAt, timeZone) === scope.ymd;
}

/**
 * Best-lap delta for `runsDesc[index]` vs the next older run with the same
 * car + track (both non-null). Positive = slower, negative = faster.
 */
export function bestDeltaVsPreviousSameCarTrack(
  runsDesc: Array<{ carId: string | null; trackId: string | null; best: number | null }>,
  index: number
): number | null {
  const run = runsDesc[index];
  if (!run || run.best == null || !run.carId || !run.trackId) return null;
  for (let i = index + 1; i < runsDesc.length; i++) {
    const prev = runsDesc[i];
    if (prev.carId !== run.carId || prev.trackId !== run.trackId) continue;
    if (prev.best == null) return null;
    return run.best - prev.best;
  }
  return null;
}

/** Float-tolerant "this run's best IS the stored car+track minimum". */
export function isTrackCarPersonalBest(
  best: number | null,
  minBestAtTrackCar: number | null,
  epsilon = 1e-4
): boolean {
  if (best == null || minBestAtTrackCar == null) return false;
  return best <= minBestAtTrackCar + epsilon;
}

/**
 * Per-run setup-change markers keyed by run id, computed over a newest-first
 * window. Each run diffs against the next older run **on the same car**; the
 * first run on a car (no baseline) and runs with no setup change get no entry.
 * Tire / battery / additive changes are excluded (see `isExcludedSetupChangeKey`).
 */
export function computeSetupChangesByRunId(
  runsDesc: Array<{ id: string; carId: string | null; setupData: unknown }>
): Map<string, RunSetupChangeIndicator> {
  const byRunId = new Map<string, RunSetupChangeIndicator>();
  for (let i = 0; i < runsDesc.length; i++) {
    const run = runsDesc[i];
    let previous: (typeof runsDesc)[number] | null = null;
    for (let j = i + 1; j < runsDesc.length; j++) {
      if (runsDesc[j].carId === run.carId) {
        previous = runsDesc[j];
        break;
      }
    }
    if (!previous) continue; // first run on this car — no baseline to diff.
    const changedFieldLabels = setupChangedRowsSincePrevious(run.setupData, previous.setupData)
      .filter((row) => !isExcludedSetupChangeKey(row.key))
      .map((row) => row.label);
    if (changedFieldLabels.length > 0) byRunId.set(run.id, { changedFieldLabels });
  }
  return byRunId;
}

/** Distinct car options in first-seen order (chronological input preserved). */
export function collectCarOptions(
  runs: Array<{ carId: string | null; carName: string }>
): AnalysisCarOption[] {
  const seen = new Map<string, AnalysisCarOption>();
  for (const run of runs) {
    const key = run.carId ?? "__none__";
    if (!seen.has(key)) seen.set(key, { carId: run.carId, carName: run.carName });
  }
  return [...seen.values()];
}
