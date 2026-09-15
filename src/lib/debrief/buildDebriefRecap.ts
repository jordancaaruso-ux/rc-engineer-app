import { computeTodayVerdict, type TodayVerdict, type VerdictRunInput } from "@/lib/dashboardVerdict";
import {
  buildGroupRunRows,
  type WorkbenchGroupSource,
  type WorkbenchRunRow,
  type WorkbenchRunSource,
} from "@/lib/runs/sessionWorkbenchModel";
import type { RunGroupZoneOptions } from "@/lib/runs/buildRunHistoryGroups";
import {
  getDisplayFiveMinuteStint,
  primaryLapRowsFromRun,
  readFiveMinStartLap,
} from "@/lib/lapAnalysis";
import { formatFiveMinuteStint } from "@/lib/runLaps";

/**
 * The figures beside a debrief — the meeting's best marks and which run set each one,
 * computed live from the rows the Sessions day already has. Nothing is stored; a late lap
 * import changes the recap the next time the day is opened.
 *
 * Founder call 2026-09-14, second pass: the first version led with a pace DIRECTION ("quicker
 * than earlier", the latest run against the median of the earlier ones) and it "doesn't mean
 * anything" at the end of a day. What does: **best lap, best average top 5, best five-minute
 * stint — and which run did it.** Meeting-wide, even on a four-day titles; the run name carries
 * the day. No comparison to anything (the headline above the chart already says "vs your last
 * visit"). Then how the car felt across the meeting, the tyres — the same three figures per
 * tyre when more than one was run, so you can read which compound the day belonged to — and
 * the air.
 */

/** A Sessions run row plus the clock fields grouping reads — `sortAt` is the ordering axis. */
export type DebriefRunSource = WorkbenchRunSource & {
  sortAt?: Date | string | null;
};

export type DebriefGroupSource = Omit<WorkbenchGroupSource, "runs"> & {
  /** Newest-first, as `WorkbenchGroupSource` demands. */
  runs: DebriefRunSource[];
};

/** Which run set a mark. `dayLabel` only on a multi-day meeting, where the name alone can't say. */
export type DebriefRunRef = {
  runId: string;
  runLabel: string;
  dayLabel: string | null;
};

export type DebriefTyre = {
  name: string;
  runCount: number;
  best: number | null;
  top5: number | null;
  /** "19/5:00.1" */
  fiveMin: string | null;
};

export type DebriefRecap = {
  runCount: number;
  lapCount: number;
  /** Local days the meeting's runs landed on. A club night is 1; a titles weekend is 2 or 3. */
  dayCount: number;
  /** The meeting's fastest lap. */
  best: ({ seconds: number } & DebriefRunRef) | null;
  /** The meeting's best average of the fastest five laps (runs with ≥5 clean laps only). */
  top5: ({ seconds: number } & DebriefRunRef) | null;
  /** The meeting's best five-minute stint — most laps, then the sooner clock. */
  fiveMin: ({ label: string; lapCount: number; seconds: number } & DebriefRunRef) | null;
  /** The driver's own ratings across the meeting, and which way they went. */
  rating: {
    arc: number[];
    direction: NonNullable<TodayVerdict["handling"]>["direction"];
  } | null;
  /** Every tyre run, in the order first run, each with its own three marks. */
  tyres: DebriefTyre[];
  airTempC: { min: number; max: number } | null;
};

type Stint = { lapCount: number; seconds: number };

/** A rating the recap will print: a whole number inside the 1–10 scale. Same rule as the strip. */
function normalizeCarRating(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1 && rounded <= 10 ? rounded : null;
}

/** More laps in five minutes wins; on equal laps, the one that got there sooner. */
function betterStint(a: Stint | null, b: Stint): boolean {
  return !a || b.lapCount > a.lapCount || (b.lapCount === a.lapCount && b.seconds < a.seconds);
}

type Pair = { row: WorkbenchRunRow; run: DebriefRunSource; stint: Stint | null };

function marksOf(pairs: Pair[]): { best: Pair | null; top5: Pair | null; fiveMin: Pair | null } {
  let best: Pair | null = null;
  let top5: Pair | null = null;
  let fiveMin: Pair | null = null;
  for (const pair of pairs) {
    if (pair.row.best != null && (best?.row.best == null || pair.row.best < best.row.best)) best = pair;
    if (pair.row.avgTop5 != null && (top5?.row.avgTop5 == null || pair.row.avgTop5 < top5.row.avgTop5))
      top5 = pair;
    if (pair.stint && betterStint(fiveMin?.stint ?? null, pair.stint)) fiveMin = pair;
  }
  return { best, top5, fiveMin };
}

export function buildDebriefRecap(
  group: DebriefGroupSource,
  opts?: { zones?: RunGroupZoneOptions }
): DebriefRecap | null {
  if (group.runs.length === 0) return null;
  const rows = buildGroupRunRows(group, opts?.zones);
  const runById = new Map(group.runs.map((run) => [run.id, run]));
  // Rows come newest-first; the arc and the tyre order want first-logged first.
  const chronological: Pair[] = [...rows]
    .reverse()
    .flatMap((row) => {
      const run = runById.get(row.id);
      if (!run) return [];
      const stint = getDisplayFiveMinuteStint(
        primaryLapRowsFromRun(run),
        readFiveMinStartLap(run.lapSession)
      );
      return [{ row, run, stint: stint ? { lapCount: stint.lapCount, seconds: stint.seconds } : null }];
    });

  const dayCount = new Set(rows.map((row) => row.dayKey)).size;
  const ref = (pair: Pair): DebriefRunRef => ({
    runId: pair.row.id,
    runLabel: pair.row.label,
    dayLabel: dayCount > 1 ? pair.row.dayLabel : null,
  });

  const marks = marksOf(chronological);

  // Only the ratings are asked of the verdict maths — its arc rules (a two-run day has no
  // direction; "flat" means every run rated the same) are the dashboard's, and the two
  // surfaces must not call one day two different things.
  const inputs: VerdictRunInput[] = chronological.map(({ row, run }) => ({
    runLabel: row.label,
    bestLap: row.best,
    avgTop5: row.avgTop5,
    carRating: normalizeCarRating(run.carRating),
    changedRows: [],
  }));
  const handling = computeTodayVerdict(inputs)?.handling ?? null;

  const tyres: DebriefTyre[] = [];
  const pairsByTyre = new Map<string, Pair[]>();
  for (const pair of chronological) {
    const name = pair.run.tireType?.displayName?.trim();
    if (!name) continue;
    const list = pairsByTyre.get(name) ?? [];
    list.push(pair);
    pairsByTyre.set(name, list);
  }
  for (const [name, pairs] of pairsByTyre) {
    const tyreMarks = marksOf(pairs);
    tyres.push({
      name,
      runCount: pairs.length,
      best: tyreMarks.best?.row.best ?? null,
      top5: tyreMarks.top5?.row.avgTop5 ?? null,
      fiveMin: tyreMarks.fiveMin?.stint ? formatFiveMinuteStint(tyreMarks.fiveMin.stint, 1) : null,
    });
  }

  const temps = group.runs
    .map((run) => run.conditionsAirTempC)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));

  return {
    runCount: rows.length,
    lapCount: rows.reduce((n, r) => n + r.lapCount, 0),
    dayCount,
    best: marks.best ? { seconds: marks.best.row.best!, ...ref(marks.best) } : null,
    top5: marks.top5 ? { seconds: marks.top5.row.avgTop5!, ...ref(marks.top5) } : null,
    fiveMin:
      marks.fiveMin && marks.fiveMin.stint
        ? {
            label: formatFiveMinuteStint(marks.fiveMin.stint, 1),
            lapCount: marks.fiveMin.stint.lapCount,
            seconds: marks.fiveMin.stint.seconds,
            ...ref(marks.fiveMin),
          }
        : null,
    rating: handling ? { arc: handling.arc, direction: handling.direction } : null,
    tyres,
    airTempC: temps.length ? { min: Math.min(...temps), max: Math.max(...temps) } : null,
  };
}
