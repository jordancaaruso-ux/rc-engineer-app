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
import {
  setupChangedRowsSincePrevious,
  type SetupChangedRow,
} from "@/lib/setupCompare/changedSincePrevious";
import { isRunToRunSetupNoiseKey } from "@/lib/setupCompare/setupChangeNoise";

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
 *
 * 2026-09-15, two more figures, one row each. The debrief is "a short summary … vertically short
 * so it doesn't detract from the actual runs below it": a heat-by-heat race table and per-set
 * tyre tables were mocked up first with his real numbers and rejected as far too long.
 * - `field` — your top 5 against the middle of the field, averaged over every run whose timing
 *   sheet had other drivers on it and named you, then your best run. The page loads the sheet
 *   figures (`loadDebriefFieldGaps`) and hands them in, so this file stays pure.
 * - `tyres[].fromNew` — how much slower runs 2 to 5 on a set were than its run 1, for sets
 *   fitted new at this meeting. The number moves with the track and the driver as well as the
 *   tyre; he saw that on his own days and wants the plain number anyway.
 *
 * 2026-09-18, the setup — START against END, per car. The runs list under the card already
 * carries a wrench on every run that changed the car, so a run-by-run replay here would be the
 * same list twice on one screen. What the list cannot say is the net of the meeting: what the
 * car was on your first run against what it was on your last — the answer to "what do I bolt on
 * next time". Founder call: start setup vs end setup; NO pace beside it (a net picture has no
 * honest per-change number, and the card's "no comparison" rule stands); and a car that ended
 * where it started must not read the same as a car nobody touched — so `made` counts every
 * change along the way, and the card says "back where you started · 7 changes made".
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

/** One step of a set's life from new: its run N against that set's run 1. */
export type DebriefFromNew = {
  /** Which run on the set — 2 to 5. */
  tyreRun: number;
  /** Top 5 minus the set's run-1 top 5, seconds; positive = slower. Averaged over `sets`. */
  seconds: number;
  sets: number;
};

export type DebriefTyre = {
  name: string;
  runCount: number;
  best: number | null;
  top5: number | null;
  /** "19/5:00.1" */
  fiveMin: string | null;
  /**
   * Founder call 2026-09-15: "how much slower is run two, three, four, five from a new tyre — I
   * just want a number". Only sets fitted new at this meeting count: a set that arrives used has
   * no run 1 here to measure from (12 of his 14 practice sets did), and an age the driver wasn't
   * sure of is not "new". Empty when no set of this compound started new here.
   */
  fromNew: DebriefFromNew[];
};

/** One car's setup across the meeting: its first run against its last. */
export type DebriefSetup = {
  carId: string;
  /** Named only when the meeting ran more than one car. */
  carName: string | null;
  startRunId: string;
  endRunId: string;
  /**
   * Boxes that differ between the first and last run, end value as `value`, start as
   * `previousValue` — the shape the wrench's list draws. Tyres, additive and the sheet header
   * never appear (`isRunToRunSetupNoiseKey`, the car page's "did this run change the car" rule).
   */
  rows: SetupChangedRow[];
  /**
   * Every box change between consecutive runs, summed over the meeting. Always ≥ `rows.length`;
   * greater means changes were made and then unmade. Zero means nobody touched the car.
   */
  made: number;
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
  /**
   * Your top 5 against the field's median top 5 — negative is quicker than the middle — over
   * every run whose timing sheet had other drivers and named you: the meeting's average, and the
   * best run (the ref). Null when no run had a field.
   */
  field: ({ avg: number; best: number; runCount: number } & DebriefRunRef) | null;
  /** The driver's own ratings across the meeting, and which way they went. */
  rating: {
    arc: number[];
    direction: NonNullable<TodayVerdict["handling"]>["direction"];
  } | null;
  /** Every tyre run, in the order first run, each with its own three marks. */
  tyres: DebriefTyre[];
  airTempC: { min: number; max: number } | null;
  /** One entry per car that ran at least twice with a readable setup; empty without sheets. */
  setup: DebriefSetup[];
};

type Stint = { lapCount: number; seconds: number };

/** Runs 2 to 5 on a set: his words were "run two, three, four, five". */
const FROM_NEW_LAST_RUN = 5;

const mean = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

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

/**
 * Each later run on a set fitted new here, against that set's run 1, one compound at a time.
 * A run number logged twice on one set is one step of that set, not two sets; the steps are
 * then averaged across the sets that reached them.
 */
function fromNewOf(pairs: Pair[]): DebriefFromNew[] {
  const bySet = new Map<string, Pair[]>();
  for (const pair of pairs) {
    const setId = pair.run.tireStintId;
    // "Not sure how many runs" counts from when he got them, not from new.
    if (!setId || pair.run.tireAgeKnown === false) continue;
    const list = bySet.get(setId) ?? [];
    list.push(pair);
    bySet.set(setId, list);
  }
  const stepDeltas = new Map<number, number[]>();
  for (const setPairs of bySet.values()) {
    const base = setPairs.find((p) => p.run.tireRunNumber === 1 && p.row.avgTop5 != null)?.row.avgTop5;
    if (base == null) continue;
    const byRun = new Map<number, number[]>();
    for (const p of setPairs) {
      const n = p.run.tireRunNumber;
      if (n == null || n < 2 || n > FROM_NEW_LAST_RUN || p.row.avgTop5 == null) continue;
      const list = byRun.get(n) ?? [];
      list.push(p.row.avgTop5 - base);
      byRun.set(n, list);
    }
    for (const [n, deltas] of byRun) {
      const list = stepDeltas.get(n) ?? [];
      list.push(mean(deltas));
      stepDeltas.set(n, list);
    }
  }
  return [...stepDeltas.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tyreRun, deltas]) => ({ tyreRun, seconds: mean(deltas), sets: deltas.length }));
}

/** The car's own settings that moved between two sheets — the run-context keys dropped. */
function carChangesBetween(previous: unknown, current: unknown): SetupChangedRow[] {
  return setupChangedRowsSincePrevious(current, previous).filter(
    (row) => !isRunToRunSetupNoiseKey(row.key)
  );
}

/**
 * Each car's first run against its last, in the order the cars first went out. A run whose
 * setup the caller didn't load is skipped, not treated as blank: a missing sheet would
 * otherwise read as "every box changed". One run on a car has nothing to compare.
 */
function setupOf(
  chronological: Pair[],
  setupDataByRunId: ReadonlyMap<string, unknown> | undefined
): DebriefSetup[] {
  if (!setupDataByRunId) return [];
  const byCar = new Map<string, Pair[]>();
  for (const pair of chronological) {
    const carId = pair.run.carId;
    if (!carId || setupDataByRunId.get(pair.row.id) == null) continue;
    const list = byCar.get(carId) ?? [];
    list.push(pair);
    byCar.set(carId, list);
  }
  const out: DebriefSetup[] = [];
  for (const [carId, pairs] of byCar) {
    if (pairs.length < 2) continue;
    const dataOf = (pair: Pair) => setupDataByRunId.get(pair.row.id);
    const first = pairs[0]!;
    const last = pairs[pairs.length - 1]!;
    let made = 0;
    for (let i = 1; i < pairs.length; i++) {
      made += carChangesBetween(dataOf(pairs[i - 1]!), dataOf(pairs[i]!)).length;
    }
    out.push({
      carId,
      carName: byCar.size > 1 ? (last.run.car?.name ?? last.run.carNameSnapshot ?? null) : null,
      startRunId: first.row.id,
      endRunId: last.row.id,
      rows: carChangesBetween(dataOf(first), dataOf(last)),
      made,
    });
  }
  return out;
}

export function buildDebriefRecap(
  group: DebriefGroupSource,
  opts?: {
    zones?: RunGroupZoneOptions;
    /** Top 5 minus the field's median top 5 per run, from `loadDebriefFieldGaps`. */
    fieldGapByRunId?: ReadonlyMap<string, number>;
    /** Each run's `SetupSnapshot.data`; without it the setup line is simply absent. */
    setupDataByRunId?: ReadonlyMap<string, unknown>;
  }
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

  // The meeting's average against the field, and its best run; the earlier run wins a tie.
  const gaps = opts?.fieldGapByRunId;
  const fielded = gaps ? chronological.filter((pair) => gaps.has(pair.row.id)) : [];
  let field: DebriefRecap["field"] = null;
  if (gaps && fielded.length > 0) {
    const gapOf = (pair: Pair) => gaps.get(pair.row.id) as number;
    const bestPair = fielded.reduce((a, b) => (gapOf(b) < gapOf(a) ? b : a));
    field = {
      avg: mean(fielded.map(gapOf)),
      best: gapOf(bestPair),
      runCount: fielded.length,
      ...ref(bestPair),
    };
  }

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
      fromNew: fromNewOf(pairs),
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
    field,
    rating: handling ? { arc: handling.arc, direction: handling.direction } : null,
    tyres,
    airTempC: temps.length ? { min: Math.min(...temps), max: Math.max(...temps) } : null,
    setup: setupOf(chronological, opts?.setupDataByRunId),
  };
}
