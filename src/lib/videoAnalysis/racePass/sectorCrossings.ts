/**
 * A named lap's path, read against the corner lines — the sector times themselves.
 *
 * By the time anything gets here the hard question is already answered: this path is Cooper's car
 * on lap 7, because his start-line crossings said so. So a sector crossing is no longer a contest
 * between candidates that might be anybody. It is one object's own line of travel meeting a line
 * the driver drew, which is a geometry problem with one answer — except at a hairpin, where the
 * same short line is genuinely crossed twice a lap and only one of those is the corner meant.
 *
 * Two rules do the deciding, in this order, and the order is the point:
 *
 * 1. **Track order.** The lines were drawn in the order they are met. A lap therefore crosses
 *    them in that order, each at least a moment after the one before. Where a line offers two
 *    crossings, usually only one of them fits between its neighbours — and that is settled
 *    without any appeal to what the driver "should" have done.
 *
 * 2. **Prediction only where order has given up, and only when it is emphatic.** The founder
 *    ruling of 2026-09-08: prediction aims and warns, it never decides. It may break a tie when
 *    the two candidates are well apart in time AND one of them is wildly away from where this
 *    line is usually crossed while the other is not. Two candidates a tenth apart, both plausible,
 *    are **not** decided — the cell is marked unsure and left for a hand mark or the strip
 *    fallback. That is exactly the case that went wrong at Bendigo: the right crossing lost by
 *    two hundredths to a phantom because timing fit was the only thing being weighed.
 *
 * "Usual" here is measured from this driver's own other laps in this same footage, never from the
 * sheet: sector splits are what is being measured, so they cannot also be the assumption.
 */

import { lineGeom, type LineGeom } from "../findCrossings/geometry";
import type { SessionRole } from "../findCrossings/fromSession";
import type { SectorLine } from "../findCrossings/types";
import type { Obs } from "../trace/chain";
import type { NamedLap } from "./name";
import {
  crossingsAgainst,
  snapToStrip,
  END_TOLERANCE_CAR_LENGTHS,
  MAX_STEP_SEC,
  SAME_PASS_SEC,
  type CrossingSource,
  type SnappedCrossing,
  type StripCandidate,
} from "./pathCrossings";

/**
 * Least time between two corners, as `identify.ts` uses for the same job. Nothing on a club track
 * takes two sector lines inside a third of a second.
 */
export const MIN_SECTOR_GAP_SEC = 0.3;

/**
 * How far from where a line is usually crossed still counts as the same corner, when prediction
 * is allowed to break a tie at all. The field matcher's gate, for the same reason: real lap-to-lap
 * scatter at a corner is a few tenths and a bobble is half a second.
 */
export const USUAL_GATE_SEC = 0.8;

/** Beyond this from usual, a crossing is kept and flagged for the review rather than believed quietly. */
export const SURPRISE_SEC = 1.0;

/** Fewest laps before this driver's own "usual" offset at a line means anything. */
export const MIN_LAPS_FOR_USUAL = 3;

export type SectorCrossing = {
  key: string;
  name: string;
  role?: SessionRole;
  lapNumber: number;
  lineKey: string;
  /** Seconds on the video clock. */
  t: number;
  x: number;
  y: number;
  dir: 1 | -1;
  source: CrossingSource;
  quality: number | null;
  /** Everything else this lap's path did at this line — the evidence, kept for the review. */
  others: SnappedCrossing[];
  /** Far from where this driver usually crosses here: a lost second, or a wrong path. */
  surprise: boolean;
  /**
   * Track order could not separate two candidates and prediction was not entitled to. The time is
   * still reported, but nothing downstream may write it as a mark.
   */
  unsure: boolean;
};

export type MissingCrossing = {
  key: string;
  name: string;
  role?: SessionRole;
  lapNumber: number;
  lineKey: string;
  /** Where in the lap it should be, for the fallback to bracket its search. */
  fromSec: number;
  toSec: number;
  /**
   * How close the path got to this line, in car lengths, and null when there was no path at all.
   *
   * The difference between "the car was never seen near here" and "the car went past a metre wide
   * of a line drawn fifty pixels long" is the whole diagnosis, and without it a missing crossing
   * is just a shrug.
   */
  nearestCarLengths: number | null;
};

export type SectorResult = {
  crossings: SectorCrossing[];
  missing: MissingCrossing[];
};

/** One line's candidates on one lap, in time order. */
type LineCandidates = { lineKey: string; list: SnappedCrossing[] };

/**
 * Which candidates can survive track order.
 *
 * A tiny search over "one candidate per line, or none", keeping only arrangements that reach the
 * most lines and run in order with a gap for every line between. Every candidate appearing in any
 * such arrangement is returned per line: one means settled, more than one means order alone could
 * not say.
 */
export function orderable(lines: LineCandidates[], minGap = MIN_SECTOR_GAP_SEC): Array<Set<number>> {
  const n = lines.length;
  const best: { count: number; picks: Array<number[]> } = { count: -1, picks: [] };

  const walk = (i: number, lastLine: number, lastT: number, chosen: number[], count: number): void => {
    if (i === n) {
      if (count > best.count) {
        best.count = count;
        best.picks = [chosen.slice()];
      } else if (count === best.count) {
        best.picks.push(chosen.slice());
      }
      return;
    }
    // Skipping a line is always allowed: a crossing may simply not have been seen.
    chosen.push(-1);
    walk(i + 1, lastLine, lastT, chosen, count);
    chosen.pop();
    for (let c = 0; c < lines[i]!.list.length; c++) {
      const t = lines[i]!.list[c]!.t;
      // Every line between the last one taken and this one still needs its own moment.
      if (lastLine >= 0 && t < lastT + minGap * (i - lastLine)) continue;
      chosen.push(c);
      walk(i + 1, i, t, chosen, count + 1);
      chosen.pop();
    }
  };
  walk(0, -1, -Infinity, [], 0);

  const out: Array<Set<number>> = lines.map(() => new Set<number>());
  for (const picks of best.picks) {
    for (let i = 0; i < n; i++) {
      const c = picks[i]!;
      if (c >= 0) out[i]!.add(c);
    }
  }
  return out;
}

/**
 * How near this line the car has to be, in car lengths, for a strip crossing at that moment to be
 * this car's.
 *
 * The strip cannot say whose crossing it saw; the path can, and this is how. Two lengths is close
 * enough to be the thing that crossed and far enough that a couple of frames of blob jitter, or a
 * sighting a fifth of a second either side, does not disown a real crossing.
 */
export const VOUCH_CAR_LENGTHS = 1.5;

/** How far a point sits off a drawn segment, in pixels. */
function offSegment(x: number, y: number, g: LineGeom): number {
  const len2 = g.norm * g.norm;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - g.p1x) * g.dx + (y - g.p1y) * g.dy) / len2)) : 0;
  return Math.hypot(x - (g.p1x + g.dx * u), y - (g.p1y + g.dy * u));
}

/**
 * Where the path was, relative to a line, at a given moment — in car lengths, or null when the
 * car was not seen anywhere near that moment.
 *
 * Interpolated between the two sightings either side, and only when they are close enough in time
 * to mean something: a car unseen for a second was not "near the line" at any point in between,
 * whatever a straight line through the gap would suggest.
 */
function nearAt(points: ReadonlyArray<Obs>, g: LineGeom, t: number, carPx: number): number | null {
  if (points.length < 2 || !(carPx > 0)) return null;
  let i = 1;
  while (i < points.length && points[i]!.t < t) i++;
  const a = points[i - 1]!;
  const b = points[Math.min(i, points.length - 1)]!;
  if (t < a.t - MAX_STEP_SEC || t > b.t + MAX_STEP_SEC) return null;
  if (b.t - a.t > MAX_STEP_SEC) return null;
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  const x = a.x + (b.x - a.x) * k;
  const y = a.y + (b.y - a.y) * k;
  const len2 = g.norm * g.norm;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - g.p1x) * g.dx + (y - g.p1y) * g.dy) / len2)) : 0;
  return Math.hypot(x - (g.p1x + g.dx * u), y - (g.p1y + g.dy * u)) / carPx;
}

/**
 * How close a path ever came to a line, in car lengths — the diagnosis behind a missing crossing.
 */
function nearest(points: ReadonlyArray<Obs>, g: LineGeom, carPx: number): number | null {
  if (!points.length || !(carPx > 0)) return null;
  const len2 = g.norm * g.norm;
  let best = Infinity;
  for (const p of points) {
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - g.p1x) * g.dx + (p.y - g.p1y) * g.dy) / len2)) : 0;
    const d = Math.hypot(p.x - (g.p1x + g.dx * t), p.y - (g.p1y + g.dy * t));
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best / carPx : null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

export type SectorOptions = {
  laps: NamedLap[];
  /** The corner lines, in the order they are met. The start line is not one of them. */
  lines: SectorLine[];
  frameW: number;
  frameH: number;
  /** What the full-resolution strip saw, per line key. */
  candidatesByLine: Map<string, StripCandidate[]>;
  carPx: number;
};

/**
 * Read every named lap's sector crossings off its own path.
 */
export function sectorCrossings(opts: SectorOptions): SectorResult {
  const { laps, lines, frameW, frameH, candidatesByLine, carPx } = opts;
  const geoms = lines.map((l) => ({ lineKey: l.lineKey, g: lineGeom(l, frameW, frameH) }));

  // Pass one: every candidate, per lap and line, with no choosing at all.
  type LapWork = { lap: NamedLap; byLine: LineCandidates[] };
  const work: LapWork[] = [];
  for (const lap of laps) {
    if (lap.points.length < 2) {
      work.push({ lap, byLine: geoms.map((g) => ({ lineKey: g.lineKey, list: [] })) });
      continue;
    }
    const byLine = geoms.map((g) => {
      const raw = crossingsAgainst(lap.points, g.g).filter(
        // Inside the lap, and actually WATCHED. A path may skip a couple of seconds when a car
        // goes behind something, and the straight line drawn across that gap crosses whatever
        // happens to lie between its ends — measured 2026-09-08, letting those through found nine
        // of nineteen hand-checked crossings with a median error of **1.3 seconds**, which is not
        // a crossing at all. A gap is a gap; the fallback can search it.
        (c) => c.t >= lap.startSec && c.t <= lap.endSec && c.solid
      );
      const strip = (candidatesByLine.get(g.lineKey) ?? []).filter(
        (c) => c.t >= lap.startSec && c.t <= lap.endSec
      );
      const snapped = snapToStrip(raw, strip, carPx);
      // The strip's own crossings that this car was there for, and that the path did not already
      // account for.
      //
      // The division of labour, stated properly: **the path says which car, the strip says when.**
      // Asking the path for the moment as well throws away the better instrument — the strip reads
      // the line at full resolution with a calibrated gate, while the path is blob centres at a
      // quarter scale. Worse, a lap whose path was simply not seen in the few frames beside the
      // line lost the crossing altogether, even though the strip had it all along. So a strip
      // crossing the path can vouch for is a crossing, whether or not the path drew one itself.
      // Vouching means: the car was near this line at that moment, on this lap.
      for (const c of strip) {
        if (snapped.some((s) => Math.abs(s.t - c.t) < SAME_PASS_SEC)) continue;
        // The strip's rectangle reaches half the line's length past each end and a further pad
        // besides, so its candidates include cars that went nowhere near the drawn line. On a
        // compact track that is how a crossing of one corner arrived labelled as the next one:
        // measured 2026-09-08, a reading four and a half seconds early at s4 was the car's real
        // s3 pass. A candidate that says where it happened has to say it happened ON the line.
        if (c.x != null && c.y != null && offSegment(c.x, c.y, g.g) > END_TOLERANCE_CAR_LENGTHS * carPx) continue;
        const near = nearAt(lap.points, g.g, c.t, carPx);
        if (near == null || near > VOUCH_CAR_LENGTHS) continue;
        snapped.push({
          t: c.t,
          x: c.x ?? 0,
          y: c.y ?? 0,
          dir: c.dir ?? 1,
          index: -1,
          stepSec: 0,
          solid: true,
          source: "confirmed",
          snappedToSec: c.t,
          quality: c.quality,
        });
      }
      return { lineKey: g.lineKey, list: snapped.sort((a, b) => a.t - b.t) };
    });
    work.push({ lap, byLine });
  }

  // What each driver usually does at each line, from their own laps where one candidate stood
  // alone. Measured, never assumed — and only ever used to break a tie order could not, or to
  // flag something worth a second look.
  const offsets = new Map<string, number[]>();
  for (const w of work) {
    for (const line of w.byLine) {
      if (line.list.length !== 1) continue;
      const key = `${w.lap.key}:${line.lineKey}`;
      const list = offsets.get(key) ?? [];
      list.push(line.list[0]!.t - w.lap.startSec);
      offsets.set(key, list);
    }
  }
  const usual = new Map<string, number>();
  for (const [key, list] of offsets) {
    if (list.length >= MIN_LAPS_FOR_USUAL) usual.set(key, median(list));
  }

  const crossings: SectorCrossing[] = [];
  const missing: MissingCrossing[] = [];
  for (const w of work) {
    const { lap } = w;
    const survivors = orderable(w.byLine);
    for (const [i, line] of w.byLine.entries()) {
      const who = {
        key: lap.key,
        name: lap.name,
        ...(lap.role ? { role: lap.role } : {}),
        lapNumber: lap.lapNumber,
        lineKey: line.lineKey,
      };
      if (!line.list.length) {
        missing.push({ ...who, fromSec: lap.startSec, toSec: lap.endSec, nearestCarLengths: nearest(lap.points, geoms[i]!.g, carPx) });
        continue;
      }
      const live = [...survivors[i]!].sort((a, b) => line.list[a]!.t - line.list[b]!.t);
      if (!live.length) {
        missing.push({ ...who, fromSec: lap.startSec, toSec: lap.endSec, nearestCarLengths: nearest(lap.points, geoms[i]!.g, carPx) });
        continue;
      }
      const usualAt = usual.get(`${lap.key}:${line.lineKey}`);
      let pickIndex = live[0]!;
      let unsure = false;
      if (live.length > 1) {
        // Order has given up. Prediction may only step in when it is emphatic: the candidates
        // must be well apart in time, and exactly one of them near where this driver usually
        // crosses here. Anything less and the cell says it does not know.
        const spread = line.list[live[live.length - 1]!]!.t - line.list[live[0]!]!.t;
        const inside =
          usualAt == null
            ? []
            : live.filter((c) => Math.abs(line.list[c]!.t - lap.startSec - usualAt) <= USUAL_GATE_SEC);
        if (usualAt != null && spread > MIN_SECTOR_GAP_SEC && inside.length === 1) {
          pickIndex = inside[0]!;
        } else {
          unsure = true;
        }
      }
      const picked = line.list[pickIndex]!;
      const offset = picked.t - lap.startSec;
      crossings.push({
        ...who,
        t: picked.t,
        x: picked.x,
        y: picked.y,
        dir: picked.dir,
        source: picked.source,
        quality: picked.quality,
        others: line.list.filter((_, k) => k !== pickIndex),
        surprise: usualAt != null && Math.abs(offset - usualAt) > SURPRISE_SEC,
        unsure,
      });
    }
  }

  return { crossings, missing };
}
