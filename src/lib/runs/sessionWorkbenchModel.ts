import {
  computeAnalysisRunMetrics,
  computeLapDistribution,
  computeSetupChangesByRunId,
  nameScopedRuns,
  runRowTitle,
  shortRunLabel,
  type AnalysisTrendModel,
  type AnalysisTrendRun,
} from "@/lib/analysis/analysisHomeModel";
import {
  resolveRunLocalTimeZone,
  type RunGroupZoneOptions,
} from "@/lib/runs/buildRunHistoryGroups";
import { computeTireIndicatorsByRunId } from "@/lib/runs/tireSetChange";
import {
  setupChangedRowsSincePrevious,
  type SetupChangedRow,
} from "@/lib/setupCompare/changedSincePrevious";
import { isExcludedSetupChangeKey } from "@/lib/setupCompare/setupChangeNoise";
import { normalizeSetupData } from "@/lib/runSetup";
import { formatRunDateShort, formatRunTimeOnly } from "@/lib/formatDate";
import { runSessionName } from "@/lib/runSession";
import { runNeedsLapImport } from "@/lib/runs/lapImportPrompt";
import type { TeamDayModel } from "@/lib/runs/teamDayModel";

/**
 * Shaping for the desktop Sessions workbench (`SessionsWorkbench`).
 *
 * The phone reads Sessions as a list you tap into; a 1440px screen can hold the
 * list AND what it points at, so at lg+ the same rows drive a reading pane that
 * shows either the whole day's trend or one run. This file builds the day-level
 * half — one `AnalysisTrendModel` per session group, exactly the shape
 * `SessionTrendCard` already renders on /analysis, so the two can never drift.
 *
 * Prisma-free on purpose (mirrors `analysisHomeModel`) — it takes rows the page
 * has already fetched rather than querying again.
 */

/** Minimum runs with laps before a group's trend chart says anything. */
export const WORKBENCH_TREND_MIN_RUNS = 1;

export type WorkbenchRunSource = {
  id: string;
  /** Driver of the run. Solo scope never reads it; team scope splits on it. */
  userId?: string | null;
  carId: string | null;
  carNameSnapshot?: string | null;
  car?: { name: string } | null;
  createdAt: Date | string;
  /** Zone the run was logged in — the clock its time of day is printed on. */
  localTimeZone?: string | null;
  lapTimes: unknown;
  lapSession?: unknown;
  /** All three read by `runNeedsLapImport` for the rail's "no lap times" mark. */
  importedLapSets?: readonly unknown[] | null;
  lapImportPromptDismissedAt?: Date | string | null;
  loggingComplete?: boolean | null;
  bestLapSeconds?: number | null;
  avgTop5LapSeconds?: number | null;
  /** All four name the session: `runSessionName` for rows, `shortRunLabel` for the axis. */
  sessionType?: string | null;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  tireStintId?: string | null;
  tireRunNumber?: number | null;
  tireAgeKnown?: boolean | null;
  tireType?: { id: string; displayName: string } | null;
  /**
   * The trend card's two non-lap figures. Optional like the rest of this structural
   * type, so a caller that doesn't select them gets a strip with dashes rather than a
   * type error — but both `/analysis` and `/runs/history` already select them for the
   * run panel, so in practice the columns are on the row before this file sees it.
   */
  carRating?: number | null;
  conditionsAirTempC?: number | null;
};

/**
 * The slice of a `RunHistoryGroup` this file reads. Structural rather than the
 * full group type so the page can pass its Prisma rows straight in — the group
 * carries plenty of fields (sortAt, eventId, …) that shaping never touches.
 */
export type WorkbenchGroupSource = {
  title: string;
  type: "Testing" | "Event";
  /**
   * Venue and day for the chart's scope line — a test day's title is just "Test day", so without
   * these the caption on the picture says nothing. Optional, and `"—"` counts as absent (the
   * history page uses that dash as its own empty marker in the rail).
   */
  trackName?: string | null;
  dateLabel?: string | null;
  /** Newest-first — tire and setup indicators are both "vs the previous run". */
  runs: WorkbenchRunSource[];
};

function carNameOf(run: WorkbenchRunSource): string {
  return run.car?.name ?? run.carNameSnapshot ?? "Unknown car";
}

/**
 * A car rating the trend strip is willing to print: a whole number inside the 1–10
 * scale the picker offers. Anything else is null.
 *
 * The guard is not defensive padding. `Run.carRating` is a plain nullable Int with no
 * database check on it, the column predates the current picker, and the strip colours
 * its numeral from `CAR_RATING_BANDS` — a 0 or an 11 would land outside every band and
 * fall through to the muted ink, which reads as "unrated" beside a number that plainly
 * isn't. Same rule `RunFaces` applies before it draws the dial.
 */
function normalizeCarRating(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1 && rounded <= 10 ? rounded : null;
}

/**
 * "2:41 PM" for a run row and for the trend card's readout.
 *
 * The zone is the run's own (`resolveRunLocalTimeZone`), never the reader's, for
 * the same reason the calendar day is: a session run interstate — or a teammate's day
 * read from another country — has one true clock, and it is the one that was on the pit
 * bench. The reader's zone is the last fallback, for runs logged before the app captured
 * a per-run zone.
 */
function runTimeLabel(run: WorkbenchRunSource, zones?: RunGroupZoneOptions): string {
  const zone = resolveRunLocalTimeZone(
    { localTimeZone: run.localTimeZone ?? null, userId: run.userId ?? null },
    zones
  );
  return formatRunTimeOnly(run.createdAt, zone);
}

/**
 * One group's runs as a trend model. `runsDescending` must be the group's runs
 * newest-first — the same order the page already has them in — because the tire
 * and setup-change indicators are both "vs the previous run on this car".
 *
 * `setupDataByRunId` is optional: without it the wrench row is simply absent,
 * which is the honest rendering when the page hasn't loaded setup snapshots.
 */
export function buildGroupTrendModel(
  group: WorkbenchGroupSource,
  opts?: { setupDataByRunId?: Map<string, unknown>; zones?: RunGroupZoneOptions }
): AnalysisTrendModel | null {
  const runsDescending = group.runs;
  if (runsDescending.length === 0) return null;

  const tireByRunId = computeTireIndicatorsByRunId(
    runsDescending.map((run) => ({
      id: run.id,
      carId: run.carId,
      tireStintId: run.tireStintId ?? null,
      tireRunNumber: run.tireRunNumber ?? null,
      tireAgeKnown: run.tireAgeKnown ?? null,
      tireType: run.tireType ?? null,
    }))
  );

  const setupByRunId = opts?.setupDataByRunId
    ? computeSetupChangesByRunId(
        runsDescending.map((run) => ({
          id: run.id,
          carId: run.carId,
          setupData: opts.setupDataByRunId!.get(run.id) ?? null,
        }))
      )
    : null;

  // Chronological for the chart's x-axis; fallback R{n} labels count per car so
  // switching cars still reads R1..Rn. The SAME numbering names the rail's rows
  // (`buildGroupRunRows`) — see `nameScopedRuns` for why one count, not two.
  const chronological = [...runsDescending].reverse();
  const naming = nameScopedRuns(chronological);
  const trendRuns: AnalysisTrendRun[] = [];

  for (const run of chronological) {
    const metrics = computeAnalysisRunMetrics(run);
    if (metrics.best == null) continue; // no laps, no point on the chart
    const named = naming.get(run.id);
    trendRuns.push({
      id: run.id,
      carId: run.carId,
      carName: carNameOf(run),
      shortLabel: shortRunLabel(run, (named?.runNumber ?? 1) - 1),
      /*
       * What the run WAS — "Practice", "Qualifying 2" — not where it fell in the day
       * (2026-08-26). It printed the positional name until then, which put "Run 2"
       * on the caption above a list whose rows had just stopped counting runs off;
       * one card cannot name the same run two ways. The car is left out here and only
       * here: the plot already draws one car at a time.
       */
      sessionName: runRowTitle({
        sessionType: run.sessionType ?? "TESTING",
        meetingSessionType: run.meetingSessionType,
        meetingSessionCode: run.meetingSessionCode,
        sessionLabel: run.sessionLabel,
        carName: null,
      }),
      timeLabel: runTimeLabel(run, opts?.zones),
      createdAtIso: new Date(run.createdAt).toISOString(),
      metrics,
      distribution: computeLapDistribution(run),
      tireIndicator: tireByRunId.get(run.id) ?? null,
      setupChange: setupByRunId?.get(run.id) ?? null,
      carRating: normalizeCarRating(run.carRating),
      airTempC: Number.isFinite(run.conditionsAirTempC) ? (run.conditionsAirTempC as number) : null,
    });
  }

  if (trendRuns.length < WORKBENCH_TREND_MIN_RUNS) return null;

  const carOptions: Array<{ carId: string | null; carName: string }> = [];
  const seenCars = new Set<string>();
  for (const run of trendRuns) {
    const key = run.carId ?? "__none__";
    if (seenCars.has(key)) continue;
    seenCars.add(key);
    carOptions.push({ carId: run.carId, carName: run.carName });
  }

  return {
    scopeKind: group.type === "Event" ? "event" : "day",
    // Drawn under the card's title since 2026-08-20, so it has to say where and when rather than
    // just "Test day". Same rule as `/analysis` (`trendScopeLabel`): a meeting names itself,
    // anything else is the venue and the date. The pane's own headline sits above and can scroll
    // off — the caption on the picture should not depend on what is still on screen beside it.
    scopeLabel:
      group.type === "Event"
        ? group.title
        : [group.trackName === "—" ? null : group.trackName, group.dateLabel]
            .filter(Boolean)
            .join(" · ") || group.title,
    runs: trendRuns,
    carOptions,
    defaultCarId: carOptions[0]?.carId ?? null,
  };
}

/** Compact per-run figures for the left rail's nested run rows. */
export type WorkbenchRunRow = {
  id: string;
  /**
   * The session's name — "Qualifying 2", "Race 3", "Run 4".
   *
   * This was the chart's x-axis label ("Q2", "R3") until 2026-08-17. A row has
   * width the axis hasn't, and a weekend of runs called Q1/Q2/Q3 asked the
   * driver to decode a code where the sheet on the pit bench says the words.
   * The axis keeps the short form via `AnalysisTrendRun.shortLabel`.
   */
  label: string;
  /**
   * The row's first line — "Practice · A800RR" (`runRowTitle`).
   *
   * The positional name above (`label`) is what the row printed until 2026-08-26:
   * "Run 5", counted per car per day. The founder's word on the new list was that
   * "run 1-2-3 feels weird" — a driver names a session by what it WAS, and the
   * number is already answered by the clock on the line beneath. It reverses his own
   * 2026-08-25 call the other way; `label` stays because the chart's axis, the
   * setup-diff captions and the aria labels all still count runs off.
   *
   * On a day of five identical practice runs this line repeats, deliberately. That is
   * what the second line is for.
   */
  title: string;
  /** "2:41 PM" — see `runTimeLabel`. */
  timeLabel: string;
  /**
   * The row's second line — "TFTR · 19 Jul, 4:48 PM": where it ran, then when, on the
   * run's own clock. Copied from the format the founder pointed at (2026-08-26).
   * `whereLabel` is null when the group has no venue, and the line opens with the date.
   */
  whereLabel: string | null;
  whenLabel: string;
  carName: string;
  best: number | null;
  /**
   * Average of the fastest 5 and 10 included laps — race pace, where `best` is
   * one lap that came off perfectly. Both are **null unless the run actually has
   * that many laps**, which `getAverageTopN` does not enforce: it slices to
   * `min(n, length)`, so a 7-lap run happily returns the average of all seven
   * and it would print under a "Top 10" heading. A column that silently means
   * something different on short runs is worse than an empty one.
   */
  avgTop5: number | null;
  avgTop10: number | null;
  median: number | null;
  lapCount: number;
  /** This run holds the group's fastest lap. */
  isGroupBest: boolean;
  /**
   * No lap times on this run and the driver hasn't silenced the prompt. At lg+
   * the workbench replaces the accordion outright, so without this the desktop
   * rail would be the one Sessions surface that stays silent about it.
   */
  needsLapImport: boolean;
  /**
   * What moved on the car since the previous run on it — the body of the row's
   * expansion on the day screen (2026-08-24), where it replaces the chart's
   * wrench glyph. Null when the caller passed no setup snapshots, which is the
   * honest rendering for a page that never loaded them.
   */
  setupDiff: WorkbenchSetupDiff | null;
};

/**
 * The three answers "what changed on the car?" can have, kept apart because they
 * are three different things to tell a driver and one of them was being told
 * wrong. An empty setup is a real, chosen state since 2026-08-18 ("log it
 * anyway"), and diffing it against a previous run reads every field of that run
 * as having been changed — the opposite of what happened. Same split, same
 * reason, as `RunDetailPanel`.
 */
export type WorkbenchSetupDiff =
  | { mode: "no_setup" }
  | { mode: "no_baseline" }
  | { mode: "diff"; rows: SetupChangedRow[]; previousLabel: string | null };

/**
 * Rows for one group, newest-first — the order the rail lists them in.
 *
 * `setupDataByRunId` is optional and only feeds `row.setupDiff`; without it every
 * row simply carries null and the expansion says nothing about setup.
 */
export function buildGroupRunRows(
  group: WorkbenchGroupSource,
  zones?: RunGroupZoneOptions,
  opts?: { setupDataByRunId?: Map<string, unknown> }
): WorkbenchRunRow[] {
  // The same pass the chart makes, so a row and the tooltip beside it can never
  // name one run two different things (`nameScopedRuns`).
  const chronological = [...group.runs].reverse();
  const labelByRunId = new Map(
    [...nameScopedRuns(chronological)].map(([id, named]) => [id, named.label])
  );

  const setupDataByRunId = opts?.setupDataByRunId ?? null;
  const setupDiffFor = (index: number): WorkbenchSetupDiff | null => {
    if (!setupDataByRunId) return null;
    const run = group.runs[index];
    const own = setupDataByRunId.get(run.id);
    if (Object.keys(normalizeSetupData(own)).length === 0) return { mode: "no_setup" };
    // `group.runs` is newest-first, so the baseline is the next one DOWN the list
    // that ran the same car — the same walk `computeSetupChangesByRunId` makes for
    // the chart's wrench, so the row and the glyph can never disagree.
    let previous: WorkbenchRunSource | null = null;
    for (let j = index + 1; j < group.runs.length; j++) {
      if (group.runs[j].carId === run.carId) {
        previous = group.runs[j];
        break;
      }
    }
    if (!run.carId || !previous) return { mode: "no_baseline" };
    const rows = setupChangedRowsSincePrevious(own, setupDataByRunId.get(previous.id)).filter(
      (row) => !isExcludedSetupChangeKey(row.key)
    );
    return { mode: "diff", rows, previousLabel: labelByRunId.get(previous.id) ?? null };
  };

  // "—" is the history rail's own empty marker, not a venue.
  const track =
    group.trackName?.trim() && group.trackName.trim() !== "—" ? group.trackName.trim() : null;

  const rows = group.runs.map((run, index) => {
    const metrics = computeAnalysisRunMetrics(run);
    const zone = resolveRunLocalTimeZone(
      { localTimeZone: run.localTimeZone ?? null, userId: run.userId ?? null },
      zones
    );
    return {
      id: run.id,
      label: labelByRunId.get(run.id) ?? "Run",
      title: runRowTitle({
        sessionType: run.sessionType ?? "TESTING",
        meetingSessionType: run.meetingSessionType,
        meetingSessionCode: run.meetingSessionCode,
        sessionLabel: run.sessionLabel,
        carName: carNameOf(run),
      }),
      timeLabel: runTimeLabel(run, zones),
      whereLabel: track,
      // One string, not two joined at the row: the comma between the date and the
      // clock is part of the format, and a row that had to know that would be the
      // second place the rule lives.
      whenLabel: `${formatRunDateShort(run.createdAt, zone)}, ${formatRunTimeOnly(run.createdAt, zone)}`,
      carName: carNameOf(run),
      best: metrics.best,
      avgTop5: metrics.cleanLapCount >= 5 ? metrics.avgTop5 : null,
      avgTop10: metrics.cleanLapCount >= 10 ? metrics.avgTop10 : null,
      median: metrics.median,
      lapCount: metrics.cleanLapCount,
      isGroupBest: false,
      needsLapImport: runNeedsLapImport(run),
      setupDiff: setupDiffFor(index),
    };
  });

  const bests = rows.map((r) => r.best).filter((b): b is number => b != null);
  if (bests.length > 0) {
    const fastest = Math.min(...bests);
    for (const row of rows) row.isGroupBest = row.best === fastest;
  }
  return rows;
}

/**
 * One driver's slice of a team session — the level the team rail gains and the
 * solo rail doesn't have, because solo's roster is one.
 *
 * `runs` and `trend` are exactly the two things a solo group carries, built by
 * the same functions from the same rows. That is deliberate and load-bearing:
 * the screen that reads one teammate's day IS the screen that reads your own,
 * so there is no second implementation to drift.
 */
export type WorkbenchDriver = {
  userId: string;
  name: string;
  carName: string;
  /** 1-based rank by best lap within the session. */
  pos: number;
  best: number | null;
  /** `best − the day's fastest`. 0 for the leader, null with no timed lap. */
  delta: number | null;
  runs: WorkbenchRunRow[];
  trend: AnalysisTrendModel | null;
};

/**
 * The numbers above a solo day: what you did, and whether it beat last time.
 *
 * "Am I quicker here than I was?" is the question a driver opens the app with,
 * and nothing on Sessions answered it. `priorDelta` is signed lap-delta — the
 * app-wide convention, so **negative is faster**.
 */
export type WorkbenchGroupHeadline = {
  best: number | null;
  runCount: number;
  lapCount: number;
  /** "Wed 12 Aug" — your last session at this same track. Null when there isn't one. */
  priorLabel: string | null;
  priorDelta: number | null;
};

export type WorkbenchGroup = {
  id: string;
  title: string;
  type: "Testing" | "Event";
  trackName: string | null;
  dateLabel: string;
  runs: WorkbenchRunRow[];
  trend: AnalysisTrendModel | null;
  /** Solo only — the day's own figures. Null in team scope, where the day is a field. */
  headline: WorkbenchGroupHeadline | null;
  /** Team only: the roster that ran this session, fastest first. Null in solo scope. */
  drivers: WorkbenchDriver[] | null;
  /** Team only: everyone on one clock. Null in solo scope, or when no run has laps. */
  teamDay: TeamDayModel | null;
  /**
   * Runs in this session before any filter — the denominator in "2 of 8 runs".
   * Null when it wasn't counted (no filter on, or the count query hit its cap):
   * the rail then falls back to the plain "N runs" rather than printing a ratio
   * it can't stand behind.
   */
  totalRuns: number | null;
};

/**
 * Split a team session into its drivers, fastest first.
 *
 * Each driver is handed straight back through `buildGroupRunRows` and
 * `buildGroupTrendModel` — the same two calls a solo group makes — so a
 * teammate's day and your own are built by identical code from identical rows.
 */
export function buildGroupDrivers(
  group: WorkbenchGroupSource,
  opts: {
    memberDisplayByUserId: Record<string, string>;
    setupDataByRunId?: Map<string, unknown>;
    /** Run times print on the driver's clock, not the reader's — see `runTimeLabel`. */
    zones?: RunGroupZoneOptions;
  }
): WorkbenchDriver[] {
  const byUser = new Map<string, WorkbenchRunSource[]>();
  for (const run of group.runs) {
    const uid = run.userId ?? "unknown";
    const list = byUser.get(uid);
    if (list) list.push(run);
    else byUser.set(uid, [run]);
  }

  const drivers: WorkbenchDriver[] = [];
  for (const [userId, driverRuns] of byUser) {
    // `group.runs` is newest-first and the slice keeps that order, which is what
    // both builders below require: their tire and setup indicators are "vs the
    // previous run", and reversing here would compare each run to its successor.
    const driverGroup: WorkbenchGroupSource = { ...group, runs: driverRuns };
    const rows = buildGroupRunRows(driverGroup, opts.zones, {
      setupDataByRunId: opts.setupDataByRunId,
    });
    const bests = rows.map((r) => r.best).filter((b): b is number => b != null);
    drivers.push({
      userId,
      name: opts.memberDisplayByUserId[userId] ?? "Unknown driver",
      carName: rows[0]?.carName ?? "Unknown car",
      pos: 0,
      best: bests.length ? Math.min(...bests) : null,
      delta: null,
      runs: rows,
      trend: buildGroupTrendModel(driverGroup, {
        setupDataByRunId: opts.setupDataByRunId,
        zones: opts.zones,
      }),
    });
  }

  drivers.sort((a, b) =>
    a.best == null && b.best == null
      ? a.name.localeCompare(b.name)
      : a.best == null
        ? 1
        : b.best == null
          ? -1
          : a.best - b.best
  );
  const fastest = drivers[0]?.best ?? null;
  drivers.forEach((driver, index) => {
    driver.pos = index + 1;
    driver.delta = fastest != null && driver.best != null ? driver.best - fastest : null;
  });
  return drivers;
}

/**
 * The solo day's figures, including the delta against your previous session at
 * the same track.
 *
 * `prior` is that session — the caller picks it, because "same track" is decided
 * across the whole group list and this file only ever sees one group at a time.
 */
export function buildGroupHeadline(
  rows: WorkbenchRunRow[],
  prior: { dateLabel: string; rows: WorkbenchRunRow[] } | null
): WorkbenchGroupHeadline {
  const bests = rows.map((r) => r.best).filter((b): b is number => b != null);
  const best = bests.length ? Math.min(...bests) : null;
  const priorBests = (prior?.rows ?? []).map((r) => r.best).filter((b): b is number => b != null);
  const priorBest = priorBests.length ? Math.min(...priorBests) : null;
  return {
    best,
    runCount: rows.length,
    lapCount: rows.reduce((n, r) => n + r.lapCount, 0),
    priorLabel: prior && priorBest != null ? prior.dateLabel : null,
    // cell − anchor, so negative means you went faster than last time here.
    priorDelta: best != null && priorBest != null ? best - priorBest : null,
  };
}
