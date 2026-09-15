/**
 * One way through each line.
 *
 * A sector line is a corner, and a corner is driven one way. But a short line drawn at a hairpin
 * sits across both legs of it: the car crosses it heading out, turns, and crosses it again a
 * moment later heading back. At Bendigo (2026-09-02) S5 was exactly that — every lap the car
 * went through the line 1.15s after S4 in one direction and 2.2s after S4 in the other. Both are
 * genuine crossings and the detector reported both, and the window took whichever sat nearer its
 * guess. The guess differed by driver, so one driver's S5 was the first pass and the other's the
 * second: S4→S5 read 1.2s against 2.1s, S5→S6 2.5s against 1.3s, and the odd-lap check then held
 * back whichever laps disagreed with the majority. Nothing was mis-detected. The line had two
 * answers and nobody had said which one was the corner.
 *
 * The detector already records which way each candidate crossed (`CrossingEvent.dir`). So a
 * line is given one direction and held to it:
 *
 *   1. **Somebody said.** A driver who chose a picture at the picker chose a direction with it;
 *      a scan that already wrote marks for this line wrote their direction too. Either settles it.
 *   2. **Otherwise the majority.** Every car crosses a corner the same way, so across all the
 *      laps of everyone scanned, the direction most windows picked is the corner. An even split
 *      is broken by the driver being analysed ("me"), whose seeds are the ones the driver saw;
 *      still even, and the line is left alone rather than guessed at.
 *
 * Then any row whose pick went the other way is turned: the nearest candidate the right way
 * round takes its place, or — when the window never saw one — the row is emptied, which sends
 * it to the bracketed second pass with a wider window rather than writing the wrong leg.
 * Candidates the wrong way round are dropped from the row before the chain and the field
 * matching see it, so neither can put it back. The full list is still kept as evidence.
 *
 * Deliberately NOT what this does: it never decides which leg is "really" the corner. That is the
 * driver's line to move. It only makes every lap of every driver measure the same leg.
 */

import type { RefinableResult } from "./refine";
import type { CrossingEvent } from "./types";

export type LineDir = 1 | -1;

/** Two times this close are the same recorded event — a candidate's `t` copied into a row. */
const SAME_TIME_SEC = 0.001;

/** The candidate a row's time came from, so its direction can be read. Null for a hand mark. */
export function pickedCandidate(r: RefinableResult): CrossingEvent | null {
  if (r.detectedSec == null) return null;
  let best: CrossingEvent | null = null;
  for (const c of r.candidates) {
    const d = Math.abs(c.t - r.detectedSec);
    if (d > SAME_TIME_SEC) continue;
    if (!best || d < Math.abs(best.t - r.detectedSec)) best = c;
  }
  return best;
}

/**
 * Directions an earlier scan wrote into the marks, by line — the majority where they disagree.
 * Hand marks carry no direction and say nothing here.
 */
export function directionsFromMarks(
  marks: ReadonlyArray<{ lineKey: string; dir?: LineDir }>
): Map<string, LineDir> {
  const sum = new Map<string, number>();
  for (const m of marks) {
    if (!m.dir) continue;
    sum.set(m.lineKey, (sum.get(m.lineKey) ?? 0) + m.dir);
  }
  const out = new Map<string, LineDir>();
  for (const [line, s] of sum) if (s !== 0) out.set(line, s > 0 ? 1 : -1);
  return out;
}

/**
 * One direction per line: what is already known, and for every other line the direction most
 * rows picked — with `prefer` (the driver being analysed) breaking an even split.
 */
export function lineDirections<T extends RefinableResult>(
  results: T[],
  known: ReadonlyMap<string, LineDir> = new Map(),
  prefer: (r: T) => boolean = (r) => r.id.startsWith("me:")
): Map<string, LineDir> {
  const votes = new Map<string, { all: number; preferred: number }>();
  for (const r of results) {
    const c = pickedCandidate(r);
    if (!c || c.dir == null) continue;
    const v = votes.get(r.lineKey) ?? { all: 0, preferred: 0 };
    v.all += c.dir;
    if (prefer(r)) v.preferred += c.dir;
    votes.set(r.lineKey, v);
  }
  const out = new Map<string, LineDir>(known);
  for (const [line, v] of votes) {
    if (out.has(line)) continue;
    const s = v.all !== 0 ? v.all : v.preferred;
    if (s === 0) continue;
    out.set(line, s > 0 ? 1 : -1);
  }
  return out;
}

export type DirectionOutcome<T> = {
  rows: T[];
  /** Ids whose pick was the wrong way and was swapped for the nearest right-way candidate. */
  turned: string[];
  /** Ids whose pick was the wrong way with nothing the right way on offer — now empty. */
  emptied: string[];
};

/**
 * Hold every row to its line's direction. Rows in `fixed` (hand marks, lap starts) and rows on
 * lines with no known direction are untouched. A turned row takes the right-way candidate
 * nearest the window's own prediction — the same rule the window used — and the candidate's
 * own source; an emptied row keeps its candidates so the evidence stays visible.
 */
export function applyLineDirections<T extends RefinableResult>(
  results: T[],
  dirs: ReadonlyMap<string, LineDir>,
  fixed: ReadonlySet<string> = new Set()
): DirectionOutcome<T> {
  const turned: string[] = [];
  const emptied: string[] = [];
  const rows = results.map((r) => {
    if (fixed.has(r.id) || r.detectedSec == null) return r;
    const want = dirs.get(r.lineKey);
    if (want == null) return r;
    const picked = pickedCandidate(r);
    if (!picked || picked.dir == null || picked.dir === want) return r;
    let best: CrossingEvent | null = null;
    for (const c of r.candidates) {
      if (c.dir !== want) continue;
      if (!best || Math.abs(c.t - r.centerSec) < Math.abs(best.t - r.centerSec)) best = c;
    }
    if (best) {
      turned.push(r.id);
      return { ...r, detectedSec: best.t, quality: best.quality, source: best.source ?? r.source };
    }
    emptied.push(r.id);
    return { ...r, detectedSec: null, quality: null, source: null };
  });
  return { rows, turned, emptied };
}

/** The row with only its right-way candidates, for the passes that choose among them. */
export function withDirection<T extends RefinableResult>(r: T, want: LineDir | undefined): T {
  if (want == null) return r;
  const kept = r.candidates.filter((c) => c.dir == null || c.dir === want);
  return kept.length === r.candidates.length ? r : { ...r, candidates: kept };
}

/**
 * A direction that empties a quarter of a line's rows is noise, not a rule.
 *
 * A direction is a rule about which of TWO passes is the corner: at a hairpin the line is
 * crossed twice a lap, every window offers both, and holding to one leg turns the other. That
 * is what `turned` counts, and a whole driver's rows can be turned at once when their windows
 * sat on the wrong leg (the S5 hairpin above) — turning is what the rule is for.
 *
 * `emptied` is different. A row is emptied when nothing in its window went the declared way at
 * all — the line was crossed once, and that one crossing read "wrong". Direction is read off
 * which side of the line a blob's path ends up on, and where the cars cross a line at its very
 * END — Bendigo's S3 (2026-09-09), drawn from the kerb the cars clip out to a marshal's post —
 * the same crossing reads one way on one lap and the other way the next, and often BOTH ways a
 * frame apart. The picker's tap read the car going "−" that lap; held to it, the review turned
 * 12 of the driver's S3 crossings onto the nearest "−" candidate (a grey-blue flicker at the
 * kerb, a third of a second early) and emptied 18 more — half the line. Every other line on
 * every graded clip empties at most one row in thirty. That is the tell.
 *
 * Returns the lines whose direction emptied at least `share` of their picked rows.
 */
export const NOISY_DIRECTION_SHARE = 0.25;

export function unreliableDirections<T extends RefinableResult>(
  results: T[],
  outcome: Pick<DirectionOutcome<T>, "emptied">,
  share: number = NOISY_DIRECTION_SHARE
): Set<string> {
  const picked = new Map<string, number>();
  for (const r of results) {
    if (r.detectedSec == null) continue;
    picked.set(r.lineKey, (picked.get(r.lineKey) ?? 0) + 1);
  }
  const lineOf = new Map(results.map((r) => [r.id, r.lineKey]));
  const emptied = new Map<string, number>();
  for (const id of outcome.emptied) {
    const line = lineOf.get(id);
    if (line == null) continue;
    emptied.set(line, (emptied.get(line) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [line, n] of emptied) {
    const total = picked.get(line) ?? 0;
    if (total > 0 && n >= share * total) out.add(line);
  }
  return out;
}

/** One place a line was crossed, and the row whose window saw it. */
export type LinePlace = { x: number; y: number; rowId: string };

/**
 * Where each line actually gets crossed.
 *
 * A wrong-way read has to stay a penalty rather than a veto — the direction is read off a
 * handful of frames and comes back inverted often enough that vetoing it throws away real
 * crossings (`lapFit.ts`). But a penalty alone let a stranger through at Bendigo (2026-09-08):
 * on one lap the only thing the hairpin window saw was a person at the far tip of the line, and
 * with nothing to compare against, the fit took it. The lap then read a quarter of a second slow
 * into the hairpin and a fifth of a second fast out of it — errors that cancel in the lap time,
 * so nothing looked wrong.
 *
 * What told that crossing apart from a genuine one was not its direction, its colour or its
 * time. It was **where on the line it happened**. Cars cross a line in the same place lap after
 * lap: over 524 crossings the distance from one to the nearest other on its own line has a
 * median of 0px and a 99th percentile of 24px at 4K. The person stood 36px from anything else
 * that line had ever seen — the loneliest crossing in the whole set, and the only wrong-way one
 * that was lonely at all. Every other wrong-way read sat within 7px of its neighbours, which is
 * exactly the "the direction came back wrong on the car" case that must survive.
 *
 * So this collects the places, and `lapFit` refuses a candidate that is both the wrong way round
 * and standing somewhere the line is never crossed. A hairpin line crossed on both legs has two
 * clusters and keeps both: the test is distance to the nearest place, not to their average.
 */
export function linePlaces<T extends RefinableResult>(results: T[]): Map<string, LinePlace[]> {
  const out = new Map<string, LinePlace[]>();
  for (const r of results) {
    const c = pickedCandidate(r);
    if (!c || c.x == null || c.y == null) continue;
    const list = out.get(r.lineKey) ?? [];
    list.push({ x: c.x, y: c.y, rowId: r.id });
    out.set(r.lineKey, list);
  }
  return out;
}

/**
 * True when this crossing stands further than `barPx` from every place the line is crossed —
 * its own row's pick excluded, or a row would always vouch for itself. A line with nothing else
 * on it can strand nobody, so it answers false.
 */
export function isStranded(
  places: ReadonlyArray<LinePlace> | undefined,
  rowId: string,
  c: { x?: number; y?: number },
  barPx: number
): boolean {
  // No bar means nobody has said how far is far — the frame size never arrived. Judge nothing:
  // a bar of zero would otherwise strand every crossing that is not pixel-identical to another.
  if (!(barPx > 0)) return false;
  if (!places || c.x == null || c.y == null) return false;
  let sawOther = false;
  for (const p of places) {
    if (p.rowId === rowId) continue;
    sawOther = true;
    if (Math.hypot(c.x - p.x, c.y - p.y) <= barPx) return false;
  }
  return sawOther;
}
