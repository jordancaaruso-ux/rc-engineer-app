/**
 * Second pass: choose each lap's crossings together, as one lap, against the driver's own rhythm.
 *
 * The chain it replaces (`refineByChaining`) predicted each corner from the one before it, which
 * is the right instinct — adjacent-corner gaps barely vary — but it had one door left open: a
 * pick it had just made became the base for the next prediction whether or not that pick was
 * this driver's car. On Bendigo practice (IMG_4521, 2026-09-03) Jordan's lap 14 crossed S2 as a
 * twelve-pixel dot on the far line and the window produced no candidate for it; the window took
 * another car 1.4s late, the chain anchored on it, and S3, S4, S5 and S6 all followed that
 * stranger — while the right crossing sat in the pool on three of those four lines, seen on the
 * footage. One miss cost five sectors.
 *
 * So every lap is now fitted whole. For each corner line the lap's window offers a few
 * candidates, or nothing worth taking, and the fit picks the one path through them that best
 * agrees with everything known about how this driver drives a lap:
 *
 *  - **The gap from the previous chosen corner** — the chain's own signal, kept. Per driver where
 *    there are enough laps, pooled across drivers otherwise.
 *  - **Where this corner usually sits in the lap** — the offset from the lap start that this
 *    driver's other laps cluster on. A stranger 1.4s late pays for it here even when the gap
 *    from a previous wrong pick made it look consistent.
 *  - **Leaving a corner out costs a fixed amount.** Nothing is the honest answer to a window that
 *    only offers strangers, and it beats a wrong time because a gap can be filled later and a
 *    wrong time cannot be told apart from a right one by its number.
 *  - **Which way it crossed is a penalty, not a veto.** The direction of a crossing is read off a
 *    handful of frames and comes back wrong often enough (a quarter of candidates on that video
 *    arrived as +/- pairs a few frames apart). A candidate the other way round at exactly the
 *    driver's usual spot is the car; the same candidate a second off at a hairpin's return leg is
 *    not, and the offset and gap terms say so. Rows left holding a wrong-way pick the fit did not
 *    want are emptied, as `direction.ts` always emptied them.
 *
 * A lap the driver began badly runs late at every corner, and against the usual offsets that
 * looks like six strangers. So the fit runs twice: once as above, then — where the corners it
 * chose agree on how late the lap is — again with the usual offsets moved by that much, so a
 * slow lap is judged as a slow lap and not skipped line by line. A lap of strangers agrees with
 * itself too, and gets the same treatment; the odd-lap vote after this is what holds it.
 *
 * Deliberately unchanged from the chain: nothing here invents a crossing, moves one to a time no
 * candidate was seen at, or removes a pick that fits — a row the fit leaves out keeps the window's
 * own answer for the odd-lap vote to judge.
 */

import type { LineDir } from "./direction";
import { learnLapShape, type LapKeyOf, type RefinableResult, type RefineOutcome } from "./refine";
import type { CrossingEvent } from "./types";

/** Offsets this close to each other are the same corner on different laps. */
const USUAL_TOL_SEC = 0.35;
/** Fewest laps that must agree before a driver's usual offset for a line means anything. */
const MIN_USUAL_LAPS = 3;
/** Fewest laps a per-driver corner-to-corner gap is measured over before it is trusted. */
const MIN_GAP_SAMPLES = 3;
/** How far a candidate may sit from the driver's usual offset before it is not worth considering. */
const MAX_OFFSET_DRIFT_SEC = 2.0;
/** How far a gap may disagree with its usual before the pair cannot be the same car. */
const MAX_GAP_DRIFT_SEC = 1.2;
/**
 * The same, from the lap start to the first chosen corner. Looser: a lap the driver began badly
 * is late at the first corner by everything they lost, and the offset term already prices it.
 */
const MAX_START_GAP_DRIFT_SEC = 2.5;
/** Chosen corners this close in lateness agree about how late the lap runs. */
const LAP_LATE_TOL_SEC = 0.4;
/** Fewest corners that must agree before a lap is re-fitted as late. */
const MIN_LATE_LINES = 3;
/** A lap less late than this is not late; the first fit stands. */
const MIN_LATE_SEC = 0.3;

/** Weights, all in seconds of disagreement. */
const OFFSET_WEIGHT = 0.4;
const GAP_WEIGHT = 1.0;
/**
 * The lap start predicts the first corner less tightly than one corner predicts the next: the
 * first sector absorbs the whole of a slow start. Half weight, so a lap the driver began
 * badly still chains through on its corner-to-corner gaps.
 */
const START_GAP_WEIGHT = 0.5;
/** The window's own prediction, kept as a faint prior so ties fall to the window's answer. */
const SEED_WEIGHT = 0.1;
/**
 * Cost of leaving a corner out of the lap. Higher than a slow lap's offset cost per line (a lap
 * 1.5s late pays 0.6 a line), or the fit would rather skip a slow lap's corners than take them.
 */
const MISS_SEC = 1.5;
/** A crossing the tracker saw but no frame-pair flip confirmed. */
const RESCUED_SEC = 0.25;
/** A raw flicker with nothing tracked behind it. */
const UNCONFIRMED_SEC = 0.25;
/** A crossing read the other way through the line. */
const WRONG_WAY_SEC = 0.3;

export type LapFitOptions<T> = {
  /** One direction per line, where known. Candidates the other way pay `WRONG_WAY_SEC`. */
  dirs?: ReadonlyMap<string, LineDir>;
  /**
   * The full list a window saw, when the row's own list has been trimmed — `reviewResults`
   * strips wrong-way candidates from rows before the field and the vote, and the fit wants them
   * back, priced.
   */
  candidatesOf?: (r: T) => CrossingEvent[];
  /** Rows whose time is settled — hand marks, lap starts. Never moved, always on the path. */
  fixed?: ReadonlySet<string>;
};

export type LapFitOutcome<T> = RefineOutcome<T> & {
  /** Set when the fit found nothing for this row and its wrong-way pick was let go. */
  emptiedByFit?: boolean;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

function driverOfKey(key: string): string {
  const i = key.lastIndexOf(":");
  return i < 0 ? "" : key.slice(0, i);
}

/** The largest set of values within `tol` of one centre, ties to the tighter set. */
function largestCluster(values: number[], tol: number): number[] {
  let best: number[] = [];
  let bestSpread = Number.POSITIVE_INFINITY;
  for (const c of values) {
    const members = values.filter((v) => Math.abs(v - c) <= tol);
    const spread = Math.max(...members) - Math.min(...members);
    if (members.length > best.length || (members.length === best.length && spread < bestSpread)) {
      best = members;
      bestSpread = spread;
    }
  }
  return best;
}

type Node = { c: CrossingEvent; cost: number };

/**
 * Where this driver usually crosses each line and how long they take between corners, from the
 * rows already holding a time. Fixed rows (hand marks) count; so do the windows' own picks,
 * because a majority of them are right and the cluster ignores the rest.
 */
function learnDriver<T extends RefinableResult>(
  results: T[],
  sfKey: string,
  lapKey: LapKeyOf<T>,
  order: string[],
  sfAt: ReadonlyMap<string, number>,
  pooledGaps: ReadonlyMap<string, number>
) {
  const usual = new Map<string, number>();
  const gaps = new Map<string, number>();

  const byDriverLine = new Map<string, number[]>();
  const found = new Map<string, number>();
  for (const r of results) {
    if (r.lineKey === sfKey || r.detectedSec == null) continue;
    const key = lapKey(r);
    const start = sfAt.get(key);
    if (start == null) continue;
    const group = `${driverOfKey(key)}|${r.lineKey}`;
    byDriverLine.set(group, [...(byDriverLine.get(group) ?? []), r.detectedSec - start]);
    found.set(`${r.lineKey}|${key}`, r.detectedSec);
  }
  for (const [group, offsets] of byDriverLine) {
    const core = largestCluster(offsets, USUAL_TOL_SEC);
    if (core.length >= MIN_USUAL_LAPS) usual.set(group, median(core));
  }

  const laps = [...new Set(results.map(lapKey))];
  const drivers = [...new Set(laps.map(driverOfKey))];
  for (const driver of drivers) {
    const mine = laps.filter((l) => driverOfKey(l) === driver);
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const samples: number[] = [];
        for (const lap of mine) {
          const a = order[i] === sfKey ? sfAt.get(lap) : found.get(`${order[i]}|${lap}`);
          const b = found.get(`${order[j]}|${lap}`);
          if (a == null || b == null || b <= a) continue;
          samples.push(b - a);
        }
        const pair = `${order[i]}>${order[j]}`;
        if (samples.length >= MIN_GAP_SAMPLES) gaps.set(`${driver}|${pair}`, median(samples));
        else if (pooledGaps.has(pair)) gaps.set(`${driver}|${pair}`, pooledGaps.get(pair)!);
      }
    }
  }
  return { usual, gaps };
}

/**
 * Fit every lap whole. See the file comment for what is weighed; the search itself is a small
 * dynamic programme over the lines in track order, one node per candidate plus "nothing".
 */
export function refineByLapFit<T extends RefinableResult>(
  results: T[],
  sfKey: string,
  lapKey: LapKeyOf<T>,
  opts: LapFitOptions<T> = {}
): Array<LapFitOutcome<T>> {
  const shape = learnLapShape(results, sfKey, lapKey);
  const learnt = learnDriver(results, sfKey, lapKey, shape.order, shape.sfAt, shape.gaps);
  const candidatesOf = opts.candidatesOf ?? ((r: T) => r.candidates);
  const isFixed = (r: T) =>
    opts.fixed ? opts.fixed.has(r.id) : r.detectedSec != null && r.candidates.length === 0;

  const out = results.map((r) => ({ ...r }) as LapFitOutcome<T>);
  const index = new Map(out.map((r) => [`${r.lineKey}|${lapKey(r)}`, r]));
  const corners = shape.order.filter((k) => k !== sfKey);
  const n = corners.length;
  const laps = [...new Set(out.map(lapKey))];

  for (const lap of laps) {
    const driver = driverOfKey(lap);
    const start = shape.sfAt.get(lap);
    if (start == null) continue;
    const rowAt = (i: number) => index.get(`${corners[i]}|${lap}`);
    const usualOf = (i: number) => learnt.usual.get(`${driver}|${corners[i]}`);

    // Fixed rows must be on the path: a path that skips one is not allowed.
    const mustTake = corners.map((_, i) => {
      const row = rowAt(i);
      return Boolean(row && isFixed(row) && row.detectedSec != null);
    });
    // Lines strictly between `from` and `to` left out of the lap.
    const skipCost = (from: number, to: number): number => {
      let cost = 0;
      for (let m = from + 1; m < to; m++) {
        if (mustTake[m]) return Number.POSITIVE_INFINITY;
        if (rowAt(m)) cost += MISS_SEC;
      }
      return cost;
    };
    // The gap cost between two chosen corners (or the lap start and the first chosen corner).
    const gapCost = (fromLine: string, fromT: number, toLine: string, toT: number): number => {
      const delta = toT - fromT;
      if (delta <= 0) return Number.POSITIVE_INFINITY;
      const g = learnt.gaps.get(`${driver}|${fromLine}>${toLine}`);
      if (g == null) return 0;
      const drift = Math.abs(delta - g);
      const fromStart = fromLine === sfKey;
      if (drift > (fromStart ? MAX_START_GAP_DRIFT_SEC : MAX_GAP_DRIFT_SEC)) return Number.POSITIVE_INFINITY;
      return (fromStart ? START_GAP_WEIGHT : GAP_WEIGHT) * drift;
    };

    /** One fit of this lap, with the usual offsets moved `late` seconds. */
    const solve = (late: number): Map<string, CrossingEvent> => {
      // Nodes per line: the candidates on offer, priced, plus (implicitly) "nothing".
      const nodes: Node[][] = corners.map((line, i) => {
        const row = rowAt(i);
        if (!row) return [];
        if (isFixed(row) && row.detectedSec != null) {
          return [{ c: { t: row.detectedSec, quality: row.quality ?? 0 }, cost: 0 }];
        }
        const usual = usualOf(i);
        const want = opts.dirs?.get(line);
        const priced: Node[] = [];
        for (const c of candidatesOf(row)) {
          let cost = SEED_WEIGHT * Math.abs(c.t - row.centerSec);
          if (usual != null) {
            const drift = Math.abs(c.t - start - usual - late);
            if (drift > MAX_OFFSET_DRIFT_SEC) continue;
            cost += OFFSET_WEIGHT * drift;
          }
          if (c.source === "rescued") cost += RESCUED_SEC;
          else if (c.source === "unconfirmed") cost += UNCONFIRMED_SEC;
          if (want != null && c.dir != null && c.dir !== want) cost += WRONG_WAY_SEC;
          priced.push({ c, cost });
        }
        return priced;
      });

      // dp[i][k]: cheapest path ending with node k chosen on line i. `back` remembers the
      // previous chosen (line, node); -1 for the lap start.
      const dp: number[][] = corners.map((_, i) => nodes[i]!.map(() => Number.POSITIVE_INFINITY));
      const back: Array<Array<[number, number]>> = corners.map((_, i) =>
        nodes[i]!.map(() => [-1, -1] as [number, number])
      );
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < nodes[i]!.length; k++) {
          const node = nodes[i]![k]!;
          let best = skipCost(-1, i) + gapCost(sfKey, start, corners[i]!, node.c.t) + node.cost;
          let from: [number, number] = [-1, -1];
          for (let j = 0; j < i; j++) {
            const skip = skipCost(j, i);
            if (!Number.isFinite(skip)) continue;
            for (let q = 0; q < nodes[j]!.length; q++) {
              const prev = dp[j]![q]!;
              if (!Number.isFinite(prev)) continue;
              const total =
                prev + skip + gapCost(corners[j]!, nodes[j]![q]!.c.t, corners[i]!, node.c.t) + node.cost;
              if (total < best) {
                best = total;
                from = [j, q];
              }
            }
          }
          dp[i]![k] = best;
          back[i]![k] = from;
        }
      }

      // The cheapest ending: a last chosen corner with everything after it left out, or nothing.
      let bestTotal = skipCost(-1, n);
      let end: [number, number] = [-1, -1];
      for (let i = 0; i < n; i++) {
        const tail = skipCost(i, n);
        if (!Number.isFinite(tail)) continue;
        for (let k = 0; k < nodes[i]!.length; k++) {
          const total = dp[i]![k]! + tail;
          if (total < bestTotal) {
            bestTotal = total;
            end = [i, k];
          }
        }
      }
      const chosen = new Map<string, CrossingEvent>();
      if (!Number.isFinite(bestTotal)) return chosen;
      for (let cur = end; cur[0] >= 0; cur = back[cur[0]]![cur[1]]!) {
        chosen.set(corners[cur[0]]!, nodes[cur[0]]![cur[1]]!.c);
      }
      return chosen;
    };

    let chosen = solve(0);

    // How late does this lap run? The corners chosen so far each say, where a usual offset is
    // known; when enough of them agree, fit again with the lap judged that late.
    const lateness: number[] = [];
    for (let i = 0; i < n; i++) {
      const row = rowAt(i);
      const usual = usualOf(i);
      const c = chosen.get(corners[i]!);
      if (!row || isFixed(row) || usual == null || !c) continue;
      lateness.push(c.t - start - usual);
    }
    const agreed = largestCluster(lateness, LAP_LATE_TOL_SEC);
    if (agreed.length >= MIN_LATE_LINES) {
      const late = median(agreed);
      if (Math.abs(late) >= MIN_LATE_SEC) chosen = solve(late);
    }

    for (let i = 0; i < n; i++) {
      const line = corners[i]!;
      const row = rowAt(i);
      if (!row || isFixed(row)) continue;
      const pick = chosen.get(line);
      if (pick) {
        if (row.detectedSec == null || Math.abs(pick.t - row.detectedSec) > 1e-9) {
          if (row.detectedSec != null) row.movedBy = pick.t - row.detectedSec;
          row.detectedSec = pick.t;
          row.quality = pick.quality;
          if (pick.source) row.source = pick.source;
        }
        continue;
      }
      // Nothing on this line fitted the lap. The window's own answer stands for the vote to
      // judge — unless it crossed the wrong way, which is exactly the case where the fit was the
      // only thing that could have vouched for it.
      const want = opts.dirs?.get(line);
      if (want != null && row.detectedSec != null) {
        const held = candidatesOf(row).find((c) => Math.abs(c.t - row.detectedSec!) <= 1e-3);
        if (held?.dir != null && held.dir !== want) {
          row.detectedSec = null;
          row.quality = null;
          row.source = null;
          row.emptiedByFit = true;
        }
      }
    }
  }

  return out;
}
