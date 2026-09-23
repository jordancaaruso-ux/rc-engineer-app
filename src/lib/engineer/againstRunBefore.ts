/**
 * "Against the run before" — each run of the day against the same car's previous run, like for
 * like, worked out here in code. Founder call 2026-09-23 ("Three. Yes, do that"): the app works
 * out the tyre effect, so "was that actually faster?" is arithmetic already done, not reasoning.
 *
 * Round 06 (2026-09-23): asked "was that actually faster?" about a run on a new set, straight
 * after a set's third run, the Engineer had every fact on the wire — top five 0.02 quicker, the
 * track 0.08 slower, set C 0.26 down by its third run — and called it "a faster package". Put
 * together they say the other thing: a fresh set should have found about a quarter of a second,
 * and the run found a tenth.
 *
 * The line, one step at a time so the driver can follow it:
 * 1. the top five's change (positive = slower);
 * 2. with the track's movement taken out — the other drivers against their own day (lapsBlock.ts),
 *    when both runs were races that carry it;
 * 3. with the tyres' age taken out as well — what today's sets lost from their first run to that
 *    run number, measured on the same footing as step 2 (track taken out, or raw). Never measured
 *    on a set both runs used: that set's own drop IS the comparison, and taking it out always
 *    leaves nothing. Left out for a car that logs its two ends as separate sets (they age apart)
 *    and for a run the app filed from the timing sheet with its tyres copied, not logged.
 *
 * A set's drop is only measured from its run 1: a used set's first run today has no "new" to be
 * measured from. The day's own sets, not the driver's history: the same track, the same day.
 *
 * Facts only — nothing here says what a difference means (north star §5).
 * Pure: no server imports, so the tests feed it hand-made runs.
 */

export type DayRunPace = {
  id: string;
  /** The clock the day block prints for this run, "15:31". */
  clock: string | null;
  top5: number | null;
  /** The other drivers against their own day in this run's race; null outside a race that carries it. */
  trackMove: number | null;
  /** The run's set of rubber (its tyre stint) and the day block's letter for it. */
  set: string | null;
  setLetter: string | null;
  /** Run number on that set; 1 = new. */
  tyreRun: number | null;
  /** Logs front and rear as separate sets. */
  splitTyres: boolean;
  /** Filed by the app from the timing sheet — tyres copied from the run before, not logged. */
  unconfirmed: boolean;
  /** The run's own laps in LAPS: the average without slow laps. */
  cleanAverage: number | null;
};

type Drop = { set: string; letter: string | null; value: number };

const fmt = (v: number): string => v.toFixed(2);

function fmtDelta(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r > 0 ? `+${r.toFixed(2)}` : r < 0 ? `-${Math.abs(r).toFixed(2)}` : "0.00";
}

function joinAnd(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** The other drivers' move between the two runs, as the track: positive = they were slower. */
function trackWords(move: number): string {
  const r = Math.round(move * 100) / 100;
  if (r === 0) return "the track the same as then";
  return `the track ${Math.abs(r).toFixed(2)} ${r > 0 ? "slower" : "quicker"} than then`;
}

function tyreName(r: DayRunPace): string {
  return `set ${r.setLetter ?? "?"} run ${r.tyreRun}`;
}

/** Each set's drop from its run 1 today to each later run number, keyed by that run number. */
function setDrops(day: readonly DayRunPace[], trackTakenOut: boolean): Map<number, Drop[]> {
  const bySet = new Map<string, DayRunPace[]>();
  for (const r of day) {
    if (!r.set || r.splitTyres || r.unconfirmed || r.tyreRun == null || r.top5 == null) continue;
    if (!bySet.has(r.set)) bySet.set(r.set, []);
    bySet.get(r.set)!.push(r);
  }
  const out = new Map<number, Drop[]>();
  for (const [set, runs] of bySet) {
    const first = runs[0];
    if (first.tyreRun !== 1) continue;
    for (const r of runs.slice(1)) {
      if (r.tyreRun == null || r.tyreRun <= 1) continue;
      let value = r.top5! - first.top5!;
      if (trackTakenOut) {
        if (r.trackMove == null || first.trackMove == null) continue;
        value -= r.trackMove - first.trackMove;
      }
      if (!out.has(r.tyreRun)) out.set(r.tyreRun, []);
      out.get(r.tyreRun)!.push({ set, letter: first.setLetter, value });
    }
  }
  return out;
}

type Loss = { run: number; value: number; from: Drop[] };

function lossAt(run: number, drops: Map<number, Drop[]>, exclude: string | null): Loss | null {
  if (run === 1) return { run, value: 0, from: [] };
  const from = (drops.get(run) ?? []).filter((d) => d.set !== exclude);
  if (from.length === 0) return null;
  return { run, value: from.reduce((a, d) => a + d.value, 0) / from.length, from };
}

/** "set C was +0.26 by its run 3" / "sets B and C were +0.30 on average by their run 2". */
function describeLoss(l: Loss): string {
  const letters = l.from.map((d) => d.letter ?? "?");
  return letters.length === 1
    ? `set ${letters[0]} was ${fmtDelta(l.value)} by its run ${l.run}`
    : `sets ${joinAnd(letters)} were ${fmtDelta(l.value)} on average by their run ${l.run}`;
}

function tyreStep(prev: DayRunPace, run: DayRunPace, day: readonly DayRunPace[], trackTakenOut: boolean, base: number): string | null {
  if (prev.splitTyres || run.splitTyres || prev.unconfirmed || run.unconfirmed) return null;
  if (prev.tyreRun == null || run.tyreRun == null || !prev.set || !run.set) return null;
  if (prev.set === run.set && prev.tyreRun === run.tyreRun) return null;
  const pair = `${tyreName(run)} against ${tyreName(prev)}`;
  if (prev.tyreRun === run.tyreRun) return `tyres the same age (${pair})`;

  const exclude = prev.set === run.set ? prev.set : null;
  const drops = setDrops(day, trackTakenOut);
  const lp = lossAt(prev.tyreRun, drops, exclude);
  const lr = lossAt(run.tyreRun, drops, exclude);
  if (!lp || !lr) {
    const missing = !lp ? prev.tyreRun : run.tyreRun;
    return `tyres: ${pair} — no ${exclude ? "other " : ""}set today went from its run 1 to a run ${missing}`;
  }
  const like = base + (lp.value - lr.value);
  const measured = [lp, lr].filter((l) => l.from.length > 0).map(describeLoss);
  return `${fmtDelta(like)} with the tyres' age taken out too (${pair}; today ${measured.join(" and ")}${trackTakenOut ? ", track taken out" : ""})`;
}

/** The line under `run`, against `prev` — the same car's previous run today. Null without two top fives. */
export function againstRunBefore(prev: DayRunPace, run: DayRunPace, day: readonly DayRunPace[]): string | null {
  if (prev.top5 == null || run.top5 == null) return null;
  const raw = run.top5 - prev.top5;
  const trackTakenOut = prev.trackMove != null && run.trackMove != null;
  const base = trackTakenOut ? raw - (run.trackMove! - prev.trackMove!) : raw;
  const steps = [`top5 ${fmtDelta(raw)}`];
  // The track's direction in words: a signed "-0.10 with the track taken out" alone was read as the
  // track moving in the driver's favour when it had gone 0.08 slower (round 06f, 2026-09-23).
  if (trackTakenOut) steps.push(`${trackWords(run.trackMove! - prev.trackMove!)}, so ${fmtDelta(base)} with it taken out`);
  const tyres = tyreStep(prev, run, day, trackTakenOut, base);
  if (tyres) steps.push(tyres);
  const clean =
    prev.cleanAverage != null && run.cleanAverage != null
      ? ` Average without slow laps ${fmt(prev.cleanAverage)} → ${fmt(run.cleanAverage)}.`
      : "";
  return `against ${prev.clock ?? "the run before"}, the run before: ${steps.join("; ")}.${clean}`;
}
