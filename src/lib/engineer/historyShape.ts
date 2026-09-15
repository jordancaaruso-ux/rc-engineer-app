import { diffTuning } from "@/lib/engineer/setupDiff";
import type { FieldPace } from "@/lib/engineer/fieldPace";
import { renderRivalSection, renderRivalsSummary } from "@/lib/engineer/rivals";

/**
 * The range block, shaped: the driver's runs across a track and a span of dates, rendered
 * for the Engineer as FACTS the app itself already shows — plus the arithmetic a driver
 * would otherwise ask the model to do (founder call 2026-09-14: "what is the delta in lap
 * time from new tyre to second run to third run").
 *
 * Pure: no database, no clock, no `server-only`, so the tables can be tested on hand-built
 * runs. driverHistory.ts loads the rows and calls in here.
 *
 * Rules carried over from the per-run block (driverData.ts):
 * - Every number is one the driver can find on screen: best lap, average of the best 5, the
 *   five-minute stint, the rating, the tyre run number, the air temperature.
 * - "changed" is what moved on the sheet since that same physical car's previous run in the
 *   list; a run with no readable sheet has no "changed" line — unknown, not unchanged.
 * - The deltas are worked out HERE, in code. The prompt forbids the model inventing a number,
 *   and subtraction across forty lap times is exactly where an invented number comes from.
 * - Sign convention is the app's: lap deltas are later − earlier, so positive = slower.
 */

export type HistoryRun = {
  id: string;
  /** Local calendar date in the logging zone, YYYY-MM-DD. */
  dateYmd: string;
  /** HH:mm in the logging zone; null when no zone is known. */
  clock: string | null;
  trackName: string | null;
  carId: string | null;
  carName: string | null;
  /** "Q2", "Testing", "Race 3" — the session segment the pickers print. */
  session: string | null;
  lapCount: number;
  best: number | null;
  top5: number | null;
  /** "19/5:13.5" — laps/time of the best five minutes. */
  fiveMin: string | null;
  rating: number | null;
  tyreName: string | null;
  tyreTypeId: string | null;
  /** 1 = first run on this rubber. */
  tyreRun: number | null;
  /** False when the driver said "not sure how many runs" — the count is relative, not age. */
  tyreAgeKnown: boolean;
  tyreStintId: string | null;
  airC: number | null;
  trackC: number | null;
  unconfirmed: boolean;
  /** Tuning keys → values; {} when the sheet is not readable. */
  tuning: Record<string, string>;
  /** Your pace against the session's field, from the timing sheet; null when there is none. */
  field: FieldPace | null;
};

/** A run where twenty things moved is noise, not evidence — say how many instead. */
const MAX_CHANGES_LISTED = 8;
/** Deltas are reported for run 2..N on a set; past this a set is rare enough to read by eye. */
const MAX_TYRE_RUN_SUMMARISED = 5;

function fmtSecs(v: number | null | undefined): string | null {
  return v == null || !Number.isFinite(v) ? null : v.toFixed(2);
}

/** "2026-09-12 Sat" — the weekday printed, so the model never has to work it out (it guessed wrong once). */
export function fmtDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return `${ymd} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]}`;
}

function fmtDelta(v: number): string {
  const s = Math.abs(v).toFixed(2);
  if (v > 0) return `+${s}`;
  if (v < 0) return `-${s}`;
  return "0.00";
}

/* ── Tyre sets ─────────────────────────────────────────────────────────────────────────── */

export type TyreSet = {
  key: string;
  runs: HistoryRun[];
  /** True when run numbers are absolute (run 1 really was the first run on the rubber). */
  ageKnown: boolean;
};

/**
 * Group runs by the rubber they were on. A stint id is the app's own grouping (minted when
 * the driver says the tyres changed). Runs logged before stint ids exist chain by the older
 * rule: same car, same compound, run number one higher than the previous run on that car.
 * A run number of 1 always starts a new set; a gap or a compound change breaks the chain.
 */
export function groupTyreSets(runs: HistoryRun[]): TyreSet[] {
  const sets: TyreSet[] = [];
  const byStint = new Map<string, TyreSet>();
  const openChainByCar = new Map<string, TyreSet>();

  for (const run of runs) {
    if (run.tyreRun == null) continue;
    const carKey = run.carId ?? "unknown";

    if (run.tyreStintId) {
      let set = byStint.get(run.tyreStintId);
      // "Run 1" inside a stint that already holds runs is the driver saying new rubber went on
      // while the app kept the old id (seen in production: a morning on runs 5–7, then a new
      // set at 11:42 under the same stint). The driver's word wins: split the set there.
      if (!set || (run.tyreRun === 1 && set.runs.length > 0)) {
        set = { key: set ? `${run.tyreStintId}#${run.id}` : run.tyreStintId, runs: [], ageKnown: run.tyreAgeKnown };
        byStint.set(run.tyreStintId, set);
        sets.push(set);
      }
      set.runs.push(run);
      // A stint id supersedes any open chain on the car: the app now knows the rubber.
      openChainByCar.delete(carKey);
      continue;
    }

    const open = openChainByCar.get(carKey);
    const last = open?.runs[open.runs.length - 1];
    const continues =
      open != null &&
      last != null &&
      run.tyreRun !== 1 &&
      last.tyreTypeId === run.tyreTypeId &&
      last.tyreRun != null &&
      run.tyreRun === last.tyreRun + 1;
    if (continues && open) {
      open.runs.push(run);
      continue;
    }
    const set: TyreSet = { key: `chain:${run.id}`, runs: [run], ageKnown: run.tyreAgeKnown };
    sets.push(set);
    openChainByCar.set(carKey, set);
  }

  // Runs inside a stint may arrive out of tyre-run order if the driver corrected a count;
  // the table reads run 1, 2, 3 — so order each set by its run number, then time.
  for (const set of sets) {
    set.runs.sort((a, b) => (a.tyreRun ?? 0) - (b.tyreRun ?? 0));
    set.ageKnown = set.runs.every((r) => r.tyreAgeKnown);
  }
  return sets;
}

/** Sets worth a line: two or more runs with a lap time each. */
function reportableSets(sets: TyreSet[]): TyreSet[] {
  return sets.filter((s) => s.runs.filter((r) => r.best != null).length >= 2);
}

function tyreSetLine(set: TyreSet, index: number): string {
  const first = set.runs[0];
  const days = new Set(set.runs.map((r) => r.dateYmd));
  const head = [
    `set ${index + 1}`,
    fmtDay(first.dateYmd),
    first.tyreName,
    set.ageKnown ? null : "(run count relative — driver was not sure how old the set was)",
    days.size > 1 ? `(spans ${days.size} days)` : null,
  ]
    .filter(Boolean)
    .join("  ");

  const baseBest = first.best;
  const baseTop5 = first.top5;
  const cells = set.runs.map((r) => {
    const bits = [`run ${r.tyreRun}`];
    if (r.best != null) {
      bits.push(`best ${fmtSecs(r.best)}`);
      if (r !== first && baseBest != null) bits.push(`(${fmtDelta(r.best - baseBest)})`);
    } else {
      bits.push("no laps");
    }
    if (r.top5 != null) {
      bits.push(`top5 ${fmtSecs(r.top5)}`);
      if (r !== first && baseTop5 != null) bits.push(`(${fmtDelta(r.top5 - baseTop5)})`);
    }
    if (r.dateYmd !== first.dateYmd) bits.push(`on ${r.dateYmd}`);
    // A set of rubber follows the car to the next meeting: a delta against run 1 at another
    // track is a track difference, not a tyre one, and the line has to say so.
    if (r.trackName !== first.trackName) bits.push(`at ${r.trackName ?? "no track"}`);
    return bits.join(" ");
  });
  return `${head}\n    ${cells.join("  ·  ")}`;
}

type DeltaAgg = { best: number[]; top5: number[] };

/**
 * Across sets: run k versus run 1 on the same rubber, averaged. Only sets whose run numbers
 * are absolute count — a "not sure" set's run 3 might be its tenth — and only pairs at the
 * same track as run 1: a set that went to another meeting compares lap times of two circuits.
 * Same-day pairs are reported separately from all pairs, because a set that spans days
 * carries a day's change in grip inside its delta, and the Engineer should be able to say
 * which it is reading.
 */
function tyreDeltaPairs(sets: TyreSet[]): { all: Map<number, DeltaAgg>; sameDay: Map<number, DeltaAgg>; counted: number } {
  const all = new Map<number, DeltaAgg>();
  const sameDay = new Map<number, DeltaAgg>();
  const bump = (m: Map<number, DeltaAgg>, k: number, best: number | null, top5: number | null) => {
    const agg = m.get(k) ?? { best: [], top5: [] };
    if (best != null) agg.best.push(best);
    if (top5 != null) agg.top5.push(top5);
    m.set(k, agg);
  };

  let counted = 0;
  for (const set of sets) {
    if (!set.ageKnown) continue;
    const first = set.runs.find((r) => r.tyreRun === 1);
    if (!first || first.best == null) continue;
    let used = false;
    for (const r of set.runs) {
      if (r === first || r.tyreRun == null || r.tyreRun < 2 || r.tyreRun > MAX_TYRE_RUN_SUMMARISED) continue;
      if (r.best == null || r.trackName !== first.trackName) continue;
      const dBest = r.best - first.best;
      const dTop5 = r.top5 != null && first.top5 != null ? r.top5 - first.top5 : null;
      bump(all, r.tyreRun, dBest, dTop5);
      if (r.dateYmd === first.dateYmd) bump(sameDay, r.tyreRun, dBest, dTop5);
      used = true;
    }
    if (used) counted++;
  }
  return { all, sameDay, counted };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The average loss per tyre run, keyed by run number (2..5), from the same pairs the TYRES
 * summary prints — so a "new-tyre equivalent" lap is best lap minus this. Empty when no set
 * has a known run 1.
 */
export type TyreAdjustments = Map<number, { best: number; top5: number | null }>;

/** One set's delta is that set's day, not a tyre-run average; two is the floor for a correction. */
const MIN_SETS_FOR_ADJUSTMENT = 2;

export function tyreAdjustments(sets: TyreSet[]): TyreAdjustments {
  const { all } = tyreDeltaPairs(sets);
  const out: TyreAdjustments = new Map();
  for (const [k, agg] of all) {
    if (agg.best.length < MIN_SETS_FOR_ADJUSTMENT) continue;
    out.set(k, { best: mean(agg.best), top5: agg.top5.length > 0 ? mean(agg.top5) : null });
  }
  return out;
}

/**
 * A run's adjustment: 0 on run 1, the average for its run number, or — past the last averaged
 * number — the last average, flagged so the line can say "at least". Null when the tyre age
 * is unknown or nothing is averaged.
 */
export function adjustmentFor(run: HistoryRun, adj: TyreAdjustments): { best: number; top5: number | null; floor: boolean } | null {
  if (run.tyreRun == null || !run.tyreAgeKnown || adj.size === 0) return null;
  if (run.tyreRun === 1) return { best: 0, top5: 0, floor: false };
  const hit = adj.get(run.tyreRun);
  if (hit) return { ...hit, floor: false };
  const maxK = Math.max(...adj.keys());
  if (run.tyreRun > maxK) return { ...adj.get(maxK)!, floor: true };
  return null;
}

export function tyreDeltaSummary(sets: TyreSet[]): string[] {
  const { all, sameDay, counted } = tyreDeltaPairs(sets);
  if (counted === 0) return [];

  const line = (label: string, m: Map<number, DeltaAgg>) => {
    const parts: string[] = [];
    for (const k of [...m.keys()].sort((a, b) => a - b)) {
      const agg = m.get(k)!;
      if (agg.best.length === 0) continue;
      const bits = [`run ${k} vs run 1: best ${fmtDelta(mean(agg.best))} (${agg.best.length} set${agg.best.length === 1 ? "" : "s"})`];
      if (agg.top5.length > 0) bits.push(`top5 ${fmtDelta(mean(agg.top5))}`);
      parts.push(bits.join(", "));
    }
    return parts.length > 0 ? `${label} — ${parts.join("; ")}` : null;
  };

  const out: string[] = [];
  const allLine = line(
    `Average across ${counted} set${counted === 1 ? "" : "s"} with a known run 1, same track as run 1`,
    all
  );
  if (allLine) out.push(allLine);
  // The same-day line only earns its place when some pair crossed a day; otherwise it would
  // repeat the line above word for word.
  const everyPairSameDay = [...all.entries()].every(
    ([k, agg]) => (sameDay.get(k)?.best.length ?? 0) === agg.best.length
  );
  if (!everyPairSameDay) {
    const sameLine = line("Same-day pairs only (no day-to-day grip change inside the delta)", sameDay);
    out.push(sameLine ?? "Same-day pairs only: none — every set here spans more than one day.");
  }
  return out;
}

export function renderTyreSection(runs: HistoryRun[]): string | null {
  const sets = reportableSets(groupTyreSets(runs));
  if (sets.length === 0) return null;
  const lines = sets.map((s, i) => tyreSetLine(s, i));
  const summary = tyreDeltaSummary(sets);
  return [
    "TYRES — one line per set of tyres with two or more timed runs. Run 1 = the first run on that",
    "rubber. Deltas are against run 1 on the same set: positive = slower. A set that spans more",
    "than one day carries the day-to-day change in grip inside its deltas; a run marked \"at\" another",
    "track is a different circuit and its delta is not a tyre delta.",
    "",
    ...lines,
    ...(summary.length > 0 ? ["", ...summary] : []),
  ].join("\n");
}

/** The same runs with the lap figures replaced by the gap to the fastest driver in that session. */
function asGapToP1(runs: HistoryRun[]): HistoryRun[] {
  return runs
    .filter((r) => r.field?.gapBestToP1 != null)
    .map((r) => ({ ...r, best: r.field!.gapBestToP1, top5: r.field!.gapTop5ToP1 }));
}

/**
 * The tyre table again, measured against the field instead of the clock: every entrant's
 * tyres aged and the track moved under them too, so this is the tyre effect with the day
 * taken out. Only for sets where two or more runs have a field.
 */
export function renderTyreFieldSection(runs: HistoryRun[]): string | null {
  const sets = reportableSets(groupTyreSets(asGapToP1(runs)));
  if (sets.length === 0) return null;
  const lines = sets.map((s, i) => tyreSetLine(s, i));
  const summary = tyreDeltaSummary(sets);
  return [
    "TYRES, AGAINST THE FIELD — the same sets, but \"best\" here is your gap to the fastest driver's best",
    "lap in that session and \"top5\" your gap to the best top-5 average in the field (0.00 = you were the",
    "fastest). Deltas are still against run 1 on the set, positive = you fell further from the front.",
    "The field aged its tyres and felt the track move too, so this is the tyre effect with the day taken",
    "out. Only runs imported from a timing sheet with two or more drivers appear.",
    "",
    ...lines,
    ...(summary.length > 0 ? ["", ...summary] : []),
  ].join("\n");
}

/** The best runs measured against the field: closest to the front first. */
export function renderBestFieldSection(runs: HistoryRun[]): string | null {
  const withField = runs.filter((r) => r.field?.gapBestToP1 != null);
  if (withField.length < 2) return null;
  const multiTrack = new Set(runs.map((r) => r.trackName)).size > 1;
  const ranked = [...withField].sort((a, b) => a.field!.gapBestToP1! - b.field!.gapBestToP1!).slice(0, 5);
  return [
    "BEST RUNS, AGAINST THE FIELD — closest to the fastest driver's best lap first. The field drove the",
    "same track at the same time, so this ranking cancels the track's own movement; tyre age is still",
    "inside it.",
    "",
    ...ranked.map(
      (r, i) =>
        `${i + 1}. ${fmtDelta(r.field!.gapBestToP1!)} to P1  P${r.field!.rank}/${r.field!.n}  ${fmtDay(r.dateYmd)}${r.clock ? ` ${r.clock}` : ""}${multiTrack ? `  ${r.trackName ?? "no track"}` : ""}  (best ${fmtSecs(r.best)} on tyre run ${r.tyreRun ?? "?"}${r.field!.gapBestToMean != null ? `, ${fmtDelta(r.field!.gapBestToMean)} vs field median` : ""})`
    ),
  ].join("\n");
}

/* ── Days ──────────────────────────────────────────────────────────────────────────────── */

export function renderDaySection(runs: HistoryRun[]): string | null {
  const byDay = new Map<string, HistoryRun[]>();
  for (const r of runs) {
    const list = byDay.get(r.dateYmd) ?? [];
    list.push(r);
    byDay.set(r.dateYmd, list);
  }
  if (byDay.size < 2) return null;

  const multiTrack = new Set(runs.map((r) => r.trackName)).size > 1;
  const lines: string[] = [];
  const moves: number[] = [];
  for (const [day, list] of byDay) {
    const timed = list.filter((r) => r.best != null);
    const bestRun = timed.reduce<HistoryRun | null>(
      (acc, r) => (acc == null || (r.best as number) < (acc.best as number) ? r : acc),
      null
    );
    const first = timed[0];
    const last = timed[timed.length - 1];
    if (first && last && first !== last) moves.push((last.best as number) - (first.best as number));
    const airs = list.map((r) => r.airC).filter((v): v is number => v != null);
    const bits = [
      fmtDay(day),
      multiTrack ? (list[0].trackName ?? "no track") : null,
      `${list.length} run${list.length === 1 ? "" : "s"}`,
      bestRun ? `best of day ${fmtSecs(bestRun.best)}` : "no lap times",
      first && last && first !== last
        ? `first timed run best ${fmtSecs(first.best)} → last ${fmtSecs(last.best)} (${fmtDelta((last.best as number) - (first.best as number))})`
        : null,
      airs.length > 0
        ? airs.length > 1 && Math.min(...airs) !== Math.max(...airs)
          ? `air ${Math.min(...airs)}–${Math.max(...airs)}°C`
          : `air ${airs[0]}°C`
        : null,
    ].filter(Boolean);
    lines.push(bits.join("  "));
  }
  // The across-days average is the one sum a "through the day" question always wants; printed
  // here so the model quotes it rather than adding the column itself.
  const avg =
    moves.length >= 2
      ? `Across ${moves.length} days with two or more timed runs, first → last best lap moved ${fmtDelta(moves.reduce((a, b) => a + b, 0) / moves.length)} on average (range ${fmtDelta(Math.min(...moves))} to ${fmtDelta(Math.max(...moves))}).`
      : null;
  return [
    "DAYS — one line per day. \"first → last\" is the best lap of the first timed run against the",
    "last: how the day moved, whatever the cause.",
    "",
    ...lines,
    ...(avg ? ["", avg] : []),
  ].join("\n");
}

/* ── Runs ──────────────────────────────────────────────────────────────────────────────── */

/** Best lap with the tyre-run loss taken back out; null when it can't be. */
export function adjustedBest(run: HistoryRun, adj: TyreAdjustments): number | null {
  const a = adjustmentFor(run, adj);
  return a && run.best != null ? run.best - a.best : null;
}

function adjustedTop5(run: HistoryRun, adj: TyreAdjustments): number | null {
  const a = adjustmentFor(run, adj);
  return a && a.top5 != null && run.top5 != null ? run.top5 - a.top5 : null;
}

export function renderRunLines(runs: HistoryRun[], adj: TyreAdjustments = new Map()): string[] {
  const multiCar = new Set(runs.map((r) => r.carId)).size > 1;
  const multiTrack = new Set(runs.map((r) => r.trackName)).size > 1;
  const lastByCar = new Map<string, HistoryRun>();
  const lines: string[] = [];

  for (const run of runs) {
    const a = adjustmentFor(run, adj);
    const eqBest = adjustedBest(run, adj);
    const eqTop5 = adjustedTop5(run, adj);
    const eq =
      eqBest != null && a
        ? `new-tyre eq ${a.floor ? "≤" : ""}${fmtSecs(eqBest)}${eqTop5 != null ? ` / ${fmtSecs(eqTop5)}` : ""}`
        : null;
    const f = run.field;
    const field =
      f && f.gapBestToP1 != null
        ? `vs field P${f.rank}/${f.n}, ${fmtDelta(f.gapBestToP1)} to P1${f.gapTop5ToP1 != null ? ` (top5 ${fmtDelta(f.gapTop5ToP1)})` : ""}${f.gapBestToMean != null ? `, ${fmtDelta(f.gapBestToMean)} vs median` : ""}`
        : null;
    const bits = [
      fmtDay(run.dateYmd),
      run.clock,
      multiTrack ? (run.trackName ?? "no track") : null,
      multiCar ? (run.carName ?? "unknown car") : null,
      run.session,
      run.best != null ? `best ${fmtSecs(run.best)}` : "no lap times",
      run.top5 != null ? `top5 ${fmtSecs(run.top5)}` : null,
      eq,
      field,
      run.fiveMin ? `5min ${run.fiveMin}` : null,
      run.lapCount > 0 ? `${run.lapCount} laps` : null,
      run.rating != null ? `rated ${run.rating}/10` : "not rated",
      run.tyreRun != null ? `tyre run ${run.tyreRun}${run.tyreAgeKnown ? "" : "?"}` : null,
      run.tyreName,
      run.airC != null ? `${run.airC}°C` : null,
      run.trackC != null ? `track ${run.trackC}°C` : null,
      run.unconfirmed ? "(unconfirmed — setup and tyres carried, not logged by the driver)" : null,
    ].filter(Boolean);
    lines.push(bits.join("  "));

    const carKey = run.carId ?? "unknown";
    const prev = lastByCar.get(carKey);
    lastByCar.set(carKey, run);
    if (!prev) continue;
    const changes = diffTuning(prev.tuning, run.tuning);
    if (changes == null) continue;
    // The tyre-corrected movement against the previous run, so a change's effect can be read
    // with the rubber's ageing already taken out — same day only, or the day is inside it too.
    const prevEq = adjustedBest(prev, adj);
    const moves: string[] = [];
    if (eqBest != null && prevEq != null && prev.dateYmd === run.dateYmd) {
      moves.push(`new-tyre eq vs previous run: ${fmtDelta(eqBest - prevEq)}`);
    }
    // Against the field the day cancels, so this one may cross days.
    if (run.field?.gapBestToP1 != null && prev.field?.gapBestToP1 != null) {
      moves.push(`gap to P1 vs previous run: ${fmtDelta(run.field.gapBestToP1 - prev.field.gapBestToP1)}`);
    }
    const eqMove = moves.length > 0 ? `  (${moves.join("; ")})` : "";
    if (changes.length === 0) {
      lines.push(`    no setup change${eqMove}`);
    } else {
      const shown = changes.slice(0, MAX_CHANGES_LISTED).join(", ");
      const more = changes.length > MAX_CHANGES_LISTED ? `, +${changes.length - MAX_CHANGES_LISTED} more` : "";
      lines.push(`    changed: ${shown}${more}${eqMove}`);
    }
  }
  return lines;
}

/** The best runs once the tyre-run loss is taken out — the ranking a driver asks for next. */
export function renderBestAdjustedSection(runs: HistoryRun[], adj: TyreAdjustments): string | null {
  if (adj.size === 0) return null;
  const ranked = runs
    .map((r) => ({ r, eq: adjustedBest(r, adj), a: adjustmentFor(r, adj) }))
    .filter((x): x is { r: HistoryRun; eq: number; a: NonNullable<ReturnType<typeof adjustmentFor>> } => x.eq != null && x.a != null)
    .sort((x, y) => x.eq - y.eq)
    .slice(0, 5);
  if (ranked.length < 2) return null;
  const multiTrack = new Set(runs.map((r) => r.trackName)).size > 1;
  return [
    "BEST RUNS, NEW-TYRE EQUIVALENT — best lap minus the average loss for that tyre run (from the TYRES",
    "table). Setup changes and the track's own movement are still inside these numbers.",
    "",
    ...ranked.map(
      ({ r, eq, a }, i) =>
        `${i + 1}. ${a.floor ? "≤" : ""}${fmtSecs(eq)}  ${fmtDay(r.dateYmd)}${r.clock ? ` ${r.clock}` : ""}${multiTrack ? `  ${r.trackName ?? "no track"}` : ""}  (raw ${fmtSecs(r.best)} on tyre run ${r.tyreRun})`
    ),
  ].join("\n");
}

/* ── The block ─────────────────────────────────────────────────────────────────────────── */

export function renderHistoryBlock(params: {
  /** "Keilor, 1 Jun – 14 Sep 2026, A800RR (cars of this type)" — what the driver chose. */
  scopeLabel: string;
  runs: HistoryRun[];
  /** Runs inside the range but older than the ones shown. */
  omittedOlder: number;
  /** The last shown run's readable sheet, or null. */
  lastSetup: { carName: string | null; dateYmd: string; rows: string[] } | null;
  /** A driver named in the question (rivals.ts `driverKey`), for a VS section; null for none. */
  rival?: string | null;
}): string | null {
  const { runs } = params;
  if (runs.length === 0) return null;
  const parts: string[] = [];
  const sets = reportableSets(groupTyreSets(runs));
  const adj = tyreAdjustments(sets);

  const multiCar = new Set(runs.map((r) => r.carId)).size > 1;
  const omitted =
    params.omittedOlder > 0
      ? ` The ${params.omittedOlder} older run${params.omittedOlder === 1 ? "" : "s"} in the range ${params.omittedOlder === 1 ? "is" : "are"} not shown.`
      : "";
  parts.push(
    [
      `DRIVER DATA — RUNS IN A RANGE. The driver chose this range: ${params.scopeLabel}. ${runs.length} run${runs.length === 1 ? "" : "s"} shown, earliest first.${omitted} Nothing outside this range is attached; the driver's other runs are not visible here.`,
      `"changed" is what moved on the setup sheet since that same ${multiCar ? "physical car's" : "car's"} previous run in this list. A run with no "changed" line has no readable sheet on one side: that is unknown, not unchanged. "tyre run N" is the Nth run on that set of rubber; a "?" means the driver was not sure how old the set was.`,
      ...(adj.size > 0
        ? [
            `"new-tyre eq" is the best lap / top 5 with the average loss for that tyre run taken back out (the TYRES table's averages), so runs on different-age rubber can be compared; "≤" marks a run past the last averaged number, corrected by that last average. It is arithmetic on this driver's own pairs, not a tyre model.`,
          ]
        : []),
      ...(runs.some((r) => r.field)
        ? [
            `"vs field" is from the timing sheet of that session: your place by best lap out of the timed entrants, your best lap minus the fastest driver's (0.00 = you were fastest), the same for the top-5 average, and your best minus the field's median best (negative = faster than the middle of the field). Everyone in the session drove the same track at the same time, so these cancel the track's own movement in a way lap times cannot. A run without it was not imported from a timing sheet with two or more drivers.`,
          ]
        : []),
      ...(runs.some((r) => r.unconfirmed)
        ? [
            `An "unconfirmed" run was filed by the app from the timing sheet: its laps are real, but its setup and tyres were copied from the previous logged run and the driver has not confirmed them. Read its pace; do not read its sheet as a deliberate change.`,
          ]
        : []),
      "",
      "RUNS",
      ...renderRunLines(runs, adj),
    ].join("\n")
  );

  const days = renderDaySection(runs);
  if (days) parts.push(days);
  const tyres = renderTyreSection(runs);
  if (tyres) parts.push(tyres);
  const best = renderBestAdjustedSection(runs, adj);
  if (best) parts.push(best);
  const tyresField = renderTyreFieldSection(runs);
  if (tyresField) parts.push(tyresField);
  const bestField = renderBestFieldSection(runs);
  if (bestField) parts.push(bestField);
  const rivals = renderRivalsSummary(runs);
  if (rivals) parts.push(rivals);
  if (params.rival) {
    const vs = renderRivalSection(runs, params.rival);
    if (vs) parts.push(vs);
  }

  if (params.lastSetup && params.lastSetup.rows.length > 0) {
    parts.push(
      [
        `SETUP ON THE CAR AT THE LAST RUN SHOWN (${params.lastSetup.carName ?? "this car"}, ${params.lastSetup.dateYmd}).`,
        "These are the values the car ran that day. Reason with them; do not read them back.",
        "",
        ...params.lastSetup.rows,
      ].join("\n")
    );
  }

  return parts.join("\n\n");
}
