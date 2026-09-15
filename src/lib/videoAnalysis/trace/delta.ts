/**
 * Two traced laps into one line: where on the lap, and how far ahead or behind.
 *
 * The idea needs no distances. A place on the track is a place on the picture, and the same
 * picture was behind both laps. Take one lap's path as the road, measure how far along it every
 * point of the other lap sits, and at each place subtract when the two laps got there. Same
 * camera, same lens, same squashing of the far side, so every error that is the same for both
 * laps cancels; what is left is time, which the frame clock gives to the frame.
 *
 * The one thing that can go wrong is putting a point of the other lap on the wrong part of the
 * road: at a hairpin the outbound and return legs sit a few pixels apart, and the nearest point
 * on the road may be on the other leg. So the search only ever moves forward along the road, in
 * a short window, and every sector crossing snaps it back to where that line sits on the road.
 *
 * Distance along the road is in normalised frame units with the picture's aspect put back, so
 * it means the same thing in both axes. It is not metres and is never shown as such: the chart's
 * axis is "how far round the lap", 0 to 1.
 */

import { RUN_BREAK_SEC } from "./smooth";
import { segmentUnverified } from "./stitch";
import type { TraceHole, TracePoint, TraceSegment } from "@/lib/manualVideoAnalysis/types";

export type LapPath = {
  points: TracePoint[];
  /** Video time the lap began at the start line. */
  startSec: number;
  endSec: number;
  holes: TraceHole[];
  segments: TraceSegment[];
};

/** A path with its running length. `x` carries the aspect so a step is the same size either way. */
export type ArcPath = {
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  s: Float64Array;
  total: number;
};

export function arcLength(points: TracePoint[], aspect: number): ArcPath {
  const n = points.length;
  const t = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const s = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    t[i] = p[0];
    x[i] = p[1] * aspect;
    y[i] = p[2];
    if (i > 0) acc += Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!);
    s[i] = acc;
  }
  return { t, x, y, s, total: acc };
}

/**
 * Linear interpolation of `ys` at `at` over a non-decreasing `xs`, allowing `tol` past either
 * end, where the nearest value is taken.
 *
 * The tolerance is what lets the lap be read to its last sector line at all. A traced lap's last
 * point is the last frame the car was SEEN in, which is a frame or two before it reached the
 * line; without a little slack every question about the end of the lap — the final tick, the
 * lap's total delta, the chart's end marker — comes back empty, which is what the first cut did.
 * Past the tolerance it is still null: a lap whose last second is a hole has no end.
 */
function interpNear(xs: Float64Array, ys: Float64Array, at: number, tol: number): number | null {
  const n = xs.length;
  if (n === 0) return null;
  if (at < xs[0]!) return at >= xs[0]! - tol ? ys[0]! : null;
  if (at > xs[n - 1]!) return at <= xs[n - 1]! + tol ? ys[n - 1]! : null;
  return interp(xs, ys, at);
}

/** Linear interpolation of `ys` at `at` over a non-decreasing `xs`; null outside its range. */
/**
 * A reading is out of range only if it is really outside, not if it is a rounding away.
 *
 * The ends of these curves are computed several ways over — arc length summed, paths carried out
 * to the crossings, the projection warped onto them — and two routes to the same end differ in
 * the last bits. Asking for the very end of a lap is the commonest question there is (the total
 * on the chart), so a hair of overshoot must not read as "off the end of the path".
 */
const RANGE_SLACK = 1e-9;

function interp(xs: Float64Array, ys: Float64Array, at: number): number | null {
  const n = xs.length;
  if (n === 0) return null;
  const slack = Math.max(RANGE_SLACK, Math.abs(xs[n - 1]! - xs[0]!) * RANGE_SLACK);
  if (at < xs[0]! - slack || at > xs[n - 1]! + slack) return null;
  at = Math.max(xs[0]!, Math.min(xs[n - 1]!, at));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= at) lo = mid;
    else hi = mid;
  }
  const span = xs[hi]! - xs[lo]!;
  if (span <= 0) return ys[lo]!;
  const k = (at - xs[lo]!) / span;
  return ys[lo]! + (ys[hi]! - ys[lo]!) * k;
}

/**
 * A crossing this long past the last point of a path still counts as that path's end: the last
 * frame the car was seen in is a frame or two before it reached the line.
 */
export const END_TOL_SEC = 0.35;

/** Two moments this close together are the same moment; for comparing carried-out path ends. */
const ENDS_EPS_SEC = 1e-6;

/**
 * A sector the tracer placed the car in fewer than this share of the frames has no path through
 * it, whatever few points it does hold, and carries no delta.
 *
 * Measured, not guessed (2026-09-06, twelve traces over three videos): a far sector seen in 7 %
 * of its frames read 1.4 s wrong, and one seen in 26 % read 1.0–1.7 s wrong — drawn numbers, not
 * gaps, which is the one thing this must never produce. Sectors from 44 % up agreed with the
 * board to a few hundredths on the same footage.
 *
 * Raised to 0.55 on 2026-09-07, when the tracer began following the car through stretches it used
 * to give up on: three sectors that had been honest gaps became confident lines 1.2–1.7 s wrong,
 * and disagreements with the board went from 3 of 34 pairs to 9. Swept over the same fifteen laps,
 * 0.55 erases every one of them and costs about 2 % of the drawn line. A sector this thin is not
 * a path; it is a handful of points with the gaps guessed between them.
 */
export const MIN_SEGMENT_COVERAGE = 0.55;

/**
 * How far the projection may miss a sector line it was NOT told about before the two sectors
 * either side of it are blanked, in seconds.
 *
 * Every crossing is known on both laps, and the projection is pinned to all of them, so at a line
 * the reading is right by construction and says nothing about the line between the lines — which
 * is the part a driver reads. But a crossing that is withheld becomes a test: run the projection
 * again without it, ask where it thinks the other lap crossed, and compare with when the scan saw
 * it. That is a measurement of exactly the thing in doubt, needs no truth the comparison does not
 * already hold, and costs one more projection a line.
 *
 * Measured over the fifteen-lap grading set, 2026-09-07: the slips are two populations. Where
 * both laps were followed through
 * their whole lap the withheld crossing came back within 3 to 47 ms, and where one of them was
 * not it came back up to 2.7 s out — with a line drawn across it either way. The two distributions
 * barely overlap, so the bar is set well above the good one and well below the bad.
 */
export const MAX_HELD_OUT_SLIP_SEC = 0.25;

/** How far along the path the car was at video time `t`. */
export function sAtTime(path: ArcPath, t: number): number | null {
  return interpNear(path.t, path.s, t, END_TOL_SEC);
}

/** A path as two arrays, the shape the interpolation wants. */
type Curve = { t: Float64Array; s: Float64Array };

/**
 * The path carried out to the lap's own start and finish crossings.
 *
 * A trace's first and last points are the first and last frames the car was SEEN in, a frame or
 * two inside the two lines. Left there, every question about the ends of the lap — the last tick,
 * the lap's total delta — is either empty or short by that gap, which read as a fifth of a second
 * on real laps. The crossings themselves are known to the frame from the scan, so the path is
 * carried to them at the speed it was doing, which is a couple of frames of travel and no more.
 * A path whose end is further off than `END_TOL_SEC` is not carried: that lap has no end.
 */
function extendToCrossings(
  t: Float64Array,
  sArr: Float64Array,
  startSec: number,
  endSec: number,
  /**
   * Where on the road those two crossings are, when it is already known. For the other lap it
   * always is: the start and finish lines are the same two places on the track for both laps —
   * that is what a line is — so its ends are pinned there rather than extrapolated, exactly as
   * the checkpoints pin it at every line in between.
   */
  pin?: { from?: number; to?: number }
): Curve {
  const n = t.length;
  if (n < 2) return { t, s: sArr };
  const ts: number[] = [];
  const ss: number[] = [];
  const gapIn = t[0]! - startSec;
  if (gapIn > 0 && gapIn <= END_TOL_SEC) {
    const dt = t[1]! - t[0]!;
    const back = dt > 0 ? ((sArr[1]! - sArr[0]!) / dt) * gapIn : 0;
    ts.push(startSec);
    ss.push(pin?.from != null ? Math.min(pin.from, sArr[0]!) : sArr[0]! - back);
  }
  for (let i = 0; i < n; i++) {
    ts.push(t[i]!);
    ss.push(sArr[i]!);
  }
  const gapOut = endSec - t[n - 1]!;
  if (gapOut > 0 && gapOut <= END_TOL_SEC) {
    const dt = t[n - 1]! - t[n - 2]!;
    const fwd = dt > 0 ? ((sArr[n - 1]! - sArr[n - 2]!) / dt) * gapOut : 0;
    ts.push(endSec);
    ss.push(pin?.to != null ? Math.max(pin.to, sArr[n - 1]!) : sArr[n - 1]! + fwd);
  }
  return { t: Float64Array.from(ts), s: Float64Array.from(ss) };
}

export type Projection = { t: Float64Array; s: Float64Array };

/** A moment on the other lap known to sit at a given place on the road. */
export type Checkpoint = { tOther: number; sBase: number };

/**
 * How far along the road one step of the other lap may reach, as a multiple of how far that point
 * actually moved across the picture. A car cannot get further round the track than it travelled.
 *
 * This was a flat share of the lap, and that is how a good pair of paths still read 1.2 s wrong
 * (measured 2026-09-07, Bendigo L4 against L9): at one frame the search found a nearer piece of
 * road most of a second further on and took it, moving 5.55 % of the lap while the car moved
 * 0.22 % — a ratio of 25, where every other step of the same lap sat at 1.0. The sector line
 * happened to fall inside that leap, so the reading there was a second and a bit out while every
 * other line on the same pair was inside four hundredths. Tying the reach to the car's own travel
 * makes the leap impossible and still opens up on its own across a hole, where the step is
 * genuinely long.
 */
const AHEAD_MULTIPLE = 4;
/** And never less than this share of the lap, so a crawling car can still be placed at all. */
const AHEAD_MIN_FRACTION = 0.005;

/**
 * How far apart the two laps' pace may be over one stretch of road before the reading there is
 * thrown away.
 *
 * The sector board checks the curve at the lines and nowhere else, so a curve can agree at every
 * line and still draw something impossible between two of them — which is the part a driver
 * actually looks at. On the Bendigo footage, 2026-09-07, one pair's line climbed to "you are a
 * second slower" a third of the way into a sector the board says you won by 0.281 s, then broke.
 * Nothing did that: it is the other lap's moment landing in the wrong place on the road, usually
 * where its own path is thin, and where that is true nothing is known about where it was.
 *
 * The line implies, at every place, a ratio between the two laps' pace. Two laps that were both
 * followed properly hold that ratio close: measured over a third of a second of your own lap
 * across the cleanest pair on the grading set (Wild Willy L2 against L3, both traced through 97 %
 * of their frames, delta matching the board to the millisecond), it never passed 1.59, with a
 * median of 1.05 and nine readings in ten under 1.19. Three is well clear of anything real and
 * still catches the impossible: a seventh of all readings across the whole set implied one lap
 * being twice the other's pace or worse, many of them the other lap taking NEGATIVE time.
 *
 * Read over a window rather than between neighbouring places on purpose: four hundred readings
 * over four hundred and fifty frames puts two neighbours inside one frame of each path, where the
 * ratio is quantisation noise and not pace.
 */
const PACE_RATIO_MAX = 3;
/**
 * Places either side of a line no rule that judges the projection may touch. At a line both laps'
 * moments come from the crossing scan rather than from the projection — the reading there is two
 * measured moments subtracted — so it is not the projection's to spoil; and a reading needs its
 * neighbours (see readingAt), so two is the least that keeps one.
 */
const PACE_KEEP_AT_LINE = 2;
/** The stretch the pace is read over, in seconds of your own lap. */
const PACE_WINDOW_SEC = 0.3;
/**
 * And the same test between neighbouring places, at a looser bound, for the spikes the window
 * cannot see.
 *
 * Reading the pace over a third of a second catches a stretch that is wrong and stays wrong. It
 * is blind to an excursion that comes back: the line leaps half a second and returns two frames
 * later, and across the window those cancel to nothing. Measured on the grading set, 2026-09-07:
 * the biggest step between neighbouring places was 0.596 s and 43 of 52 pairs held one over
 * 0.1 s, every one of them a spike a driver can see. Two cars cannot swap half a second of
 * advantage in a four-hundredth of a lap.
 *
 * What makes them is the projection standing still: where the other lap's place on the road stops
 * advancing while its clock runs on, the time at that place is any of the moments in the stall,
 * and reading one of them draws a cliff.
 *
 * Loose, because between two neighbouring places your own lap moves about a frame, and a frame is
 * where the quantisation lives — the other lap can honestly take none or two. Six is well past
 * that and well under the ten and more a stall produces.
 */
const SPIKE_RATIO_MAX = 6;
/** No step counts as shorter than this share of a frame, so a rounding cannot be a ratio. */
const SPIKE_MIN_STEP_SEC = 1 / 120;
/** Segments the search may step back, for jitter. */
const BACK_SEGMENTS = 5;
/** At a checkpoint the position may be pulled back this far, to undo drift. */
const CHECKPOINT_SLACK = 0.01;
/**
 * Two checkpoints whose raw projections land closer together than this share of the lap are not
 * pulled apart: the warp between them would be a division by nearly nothing.
 */
const PIN_MIN_SPAN = 1e-6;

function segmentIndexAt(base: ArcPath, s: number): number {
  let lo = 0;
  let hi = base.s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (base.s[mid]! <= s) lo = mid;
    else hi = mid;
  }
  return Math.min(lo, base.s.length - 2);
}

/**
 * Every point of `other` placed on `base`: its distance along the road, in time order, never
 * going backwards, re-synced at every checkpoint.
 */
export function projectOntoBase(base: ArcPath, other: ArcPath, checkpoints: Checkpoint[]): Projection {
  const n = other.t.length;
  const out = { t: new Float64Array(n), s: new Float64Array(n) };
  if (base.s.length < 2) return { t: other.t.slice(0, 0), s: new Float64Array(0) };
  const cps = [...checkpoints].sort((a, b) => a.tOther - b.tOther);
  let cp = 0;
  let j0 = 0;
  let sLast = 0;
  const minAhead = base.total * AHEAD_MIN_FRACTION;
  for (let i = 0; i < n; i++) {
    const t = other.t[i]!;
    // How far this point moved from the one before it: the reach it has earned.
    const own = i > 0 ? Math.hypot(other.x[i]! - other.x[i - 1]!, other.y[i]! - other.y[i - 1]!) : 0;
    const ahead = Math.max(minAhead, own * AHEAD_MULTIPLE);
    while (cp < cps.length && cps[cp]!.tOther <= t) {
      const sb = Math.max(0, Math.min(base.total, cps[cp]!.sBase));
      j0 = segmentIndexAt(base, sb);
      sLast = Math.min(sLast, Math.max(0, sb - base.total * CHECKPOINT_SLACK));
      cp++;
    }
    const px = other.x[i]!;
    const py = other.y[i]!;
    const from = Math.max(0, j0 - BACK_SEGMENTS);
    const sLimit = base.s[j0]! + ahead;
    let best = Infinity;
    let bestJ = j0;
    let bestS = sLast;
    for (let j = from; j < base.s.length - 1 && base.s[j]! <= sLimit; j++) {
      const ax = base.x[j]!;
      const ay = base.y[j]!;
      const bx = base.x[j + 1]!;
      const by = base.y[j + 1]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const k = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const qx = ax + dx * k;
      const qy = ay + dy * k;
      const d = Math.hypot(px - qx, py - qy);
      if (d < best) {
        best = d;
        bestJ = j;
        bestS = base.s[j]! + (base.s[j + 1]! - base.s[j]!) * k;
      }
    }
    const s = Math.max(sLast, bestS);
    out.t[i] = t;
    out.s[i] = s;
    sLast = s;
    j0 = bestJ;
  }
  return pinToCheckpoints(out, base.total, cps);
}

/**
 * The projection pulled onto the checkpoints it was given, and stretched between them.
 *
 * A checkpoint is not a hint. Both laps' crossing of a sector line is known to the frame from the
 * scan — it is the one moment in the whole comparison that is measured rather than inferred — so
 * at that line the other lap's moment belongs exactly where your lap crossed. The search above
 * only uses a checkpoint to start looking and to let the running position fall back, and then
 * takes the nearest point on your line anyway; where the two of you took different lines through
 * a corner, the nearest point is a little before or after the crossing, always in the same
 * direction, and every reading at that line inherits it. Measured 2026-09-07 over the whole
 * grading set: a median slip of 32 ms at one Bendigo line, and a reading bias at that line of
 * exactly that, in 25 of 25 pairs.
 *
 * So the raw projection is warped: each checkpoint is moved to where it belongs, and the stretch
 * between two of them is scaled to match. Monotone in, monotone out — the warp is piecewise
 * linear and increasing — so nothing about the shape of the curve inside a sector changes, and
 * the correction is spread across the sector instead of arriving as a step at the line.
 *
 * The readings at the lines then agree with the sector board by construction, which is the point:
 * the chart under the player and the table above it are the same measurement. It also means the
 * board can no longer check them, so the harness re-reads each line with that line's own
 * checkpoint dropped (`dropCheckpoints`) and checks the projection against a crossing it was
 * never told about.
 */
function pinToCheckpoints(raw: Projection, total: number, cps: Checkpoint[]): Projection {
  if (!cps.length || raw.t.length < 2) return raw;
  // Where the raw projection put each checkpoint's moment, and where it belongs.
  const from: number[] = [0];
  const to: number[] = [0];
  for (const c of cps) {
    const want = Math.max(0, Math.min(total, c.sBase));
    const got = interp(raw.t, raw.s, c.tOther);
    if (got == null) continue;
    if (got <= from[from.length - 1]! + PIN_MIN_SPAN) continue;
    if (want <= to[to.length - 1]! + PIN_MIN_SPAN) continue;
    from.push(got);
    to.push(want);
  }
  const end = Math.max(from[from.length - 1]! + PIN_MIN_SPAN, raw.s[raw.s.length - 1]!, total);
  from.push(end);
  to.push(Math.max(to[to.length - 1]! + PIN_MIN_SPAN, total));
  if (from.length < 3) return raw;
  const out = { t: raw.t, s: new Float64Array(raw.s.length) };
  let k = 0;
  for (let i = 0; i < raw.s.length; i++) {
    const v = raw.s[i]!;
    while (k < from.length - 2 && v > from[k + 1]!) k++;
    const span = from[k + 1]! - from[k]!;
    const f = span > 0 ? (v - from[k]!) / span : 0;
    out.s[i] = to[k]! + (to[k + 1]! - to[k]!) * Math.max(0, Math.min(1, f));
  }
  return out;
}

export type DeltaSample = { s: number; delta: number | null };
export type DeltaTick = { lineKey: string; s: number };

export type DeltaCurve = {
  /** `s` as a share of the lap, 0..1; `delta` in seconds, positive = you slower; null in a hole. */
  samples: DeltaSample[];
  ticks: DeltaTick[];
  /** The delta at the end of the lap, when both laps reach it. */
  total: number | null;
  /** Share of the lap for a video time on either lap, for the cursor. */
  sOfBaseTime: (t: number) => number | null;
  sOfOtherTime: (t: number) => number | null;
  /** Video time on either lap for a share of the lap, for scrubbing from the chart. */
  baseTimeOfS: (s: number) => number | null;
  otherTimeOfS: (s: number) => number | null;
};

/**
 * Stretches of a lap, as time ranges, that carry no path: the holes the tracer recorded, the gaps
 * between points it left, and any sector it barely saw at all.
 */
/**
 * How much either side of an unlocated crossing carries no delta. The curve is read at 400 places
 * over a lap, and a reading needs its neighbours (`readingAt`), so this must cover a few samples:
 * a fifth of a second is six frames, and comfortably more than three samples of any lap.
 */
const UNPINNED_BLANK_SEC = 0.2;

/**
 * The lines this lap's path was never checked against, because the scan found no position for the
 * crossing there — only its time. The path still runs through, pinned at the located crossings
 * either side, but nothing says it is in the right place AT the line.
 */
function unlocatedLines(lap: LapPath): Set<string> {
  const out = new Set<string>();
  for (const seg of lap.segments) {
    if (seg.pinned?.from === false) out.add(seg.fromKey);
    if (seg.pinned?.to === false) out.add(seg.toKey);
  }
  return out;
}

function holeRanges(lap: LapPath): Array<[number, number]> {
  const out: Array<[number, number]> = lap.holes.map((h) => [h.fromT, h.toT]);
  for (let i = 1; i < lap.points.length; i++) {
    const a = lap.points[i - 1]![0];
    const b = lap.points[i]![0];
    if (b - a > RUN_BREAK_SEC) out.push([a, b]);
  }
  for (const seg of lap.segments) {
    if (seg.coverage < MIN_SEGMENT_COVERAGE || segmentUnverified(seg)) out.push([seg.fromT, seg.toT]);
  }
  return out;
}

/**
 * The delta line between two traced laps of the same video. `base` is the lap whose path is the
 * road; `baseIsYou` says which way round the sign goes (the board's rule: positive = you slower).
 */
export function deltaCurve(
  base: LapPath,
  other: LapPath,
  opts: {
    aspect: number;
    baseIsYou: boolean;
    samples?: number;
    /**
     * Lines whose crossing the projection is NOT to be told about. For the harness: with a line
     * dropped, the reading there is the pixels' own answer and the sector board can check it.
     */
    dropCheckpoints?: ReadonlySet<string>;
  }
): DeltaCurve {
  const N = opts.samples ?? 400;
  const road = arcLength(base.points, opts.aspect);
  const path = arcLength(other.points, opts.aspect);
  // Every sector crossing the base lap carries is a place on the road; the other lap's crossing
  // of the same line is the moment it was there.
  const cps: Array<Checkpoint & { lineKey: string }> = [];
  for (const seg of base.segments) {
    const sb = sAtTime(road, seg.toT);
    if (sb == null) continue;
    if (opts.dropCheckpoints?.has(seg.toKey)) continue;
    const o = other.segments.find((x) => x.toKey === seg.toKey);
    if (o) cps.push({ tOther: o.toT, sBase: sb, lineKey: seg.toKey });
  }
  const proj = projectOntoBase(road, path, cps);
  // Every crossing withheld in turn, and the stretches either side of a crossing the projection
  // could not then find marked as guesswork.
  //
  // With one line taken away and the rest left in place, the projection has to cross two whole
  // stretches on the pictures alone and arrive at a moment the scan measured. That is the same
  // question a driver asks of the line between the markers, and it is asked with an answer in
  // hand. Both neighbouring stretches go when it fails, because either of them could be the one
  // that lost it.
  //
  // Out of the projection's reach is no answer rather than a wrong one — the other lap's path
  // stops short, which the holes already say — so it does not condemn anything. Reading that as a
  // failure blanked the first and last stretch of every lap, since a lap's own start and finish
  // crossings sit past the ends of the raw projection: the paths are carried out to them after.
  //
  // Cheap enough to do for real: one more projection per line, over a few hundred points.
  const guessed: Array<[number, number]> = [];
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]!;
    const without = projectOntoBase(road, path, cps.filter((_, k) => k !== i));
    const when = interp(without.s, without.t, c.sBase);
    if (when == null || Math.abs(when - c.tOther) <= MAX_HELD_OUT_SLIP_SEC) continue;
    guessed.push([i > 0 ? cps[i - 1]!.sBase : 0, c.sBase]);
    if (i + 1 < cps.length) guessed.push([c.sBase, cps[i + 1]!.sBase]);
  }

  // Both paths carried out to their own start and finish crossings, so the axis runs line to
  // line rather than first-frame-seen to last-frame-seen.
  const roadEnds = extendToCrossings(road.t, road.s, base.startSec, base.endSec);
  const lapFrom = roadEnds.s[0] ?? 0;
  const lapTo = roadEnds.s[roadEnds.s.length - 1] ?? 0;
  // The other lap is pinned to a line only where YOUR lap reached that line too. Where your own
  // path stops short of it — a hole over the finish — the road simply ends where it ends, and
  // pinning their finish to that point would say they got there at their finishing time.
  // Whether the road covers the lap's own start and finish — either because it was carried out
  // to them or because it already ran past them. Asked of the span, not by matching a float
  // exactly: a path whose last point falls an ulp beyond the finish covers the finish, and
  // reading that as "did not reach" costs the lap its total.
  const roadReachedStart = roadEnds.t[0]! <= base.startSec + ENDS_EPS_SEC;
  const roadReachedEnd = roadEnds.t[roadEnds.t.length - 1]! >= base.endSec - ENDS_EPS_SEC;
  const projEnds = extendToCrossings(proj.t, proj.s, other.startSec, other.endSec, {
    from: roadReachedStart ? lapFrom : undefined,
    to: roadReachedEnd ? lapTo : undefined,
  });

  // Holes on either lap, as ranges of the road. Read off the carried-out paths, so a stretch
  // that begins at a crossing — a whole sector the tracer barely saw — is inside the range and
  // becomes a gap. Mapped through the un-carried path it fell outside and was quietly skipped,
  // which is how a 7 % sector once drew a number 1.35 s wrong.
  const nullRanges: Array<[number, number]> = [];
  for (const [a, b] of holeRanges(base)) {
    const sa = interpNear(roadEnds.t, roadEnds.s, a, END_TOL_SEC);
    const sb = interpNear(roadEnds.t, roadEnds.s, b, END_TOL_SEC);
    if (sa != null && sb != null) nullRanges.push([sa, sb]);
  }
  for (const [a, b] of holeRanges(other)) {
    const sa = interpNear(projEnds.t, projEnds.s, a, END_TOL_SEC);
    const sb = interpNear(projEnds.t, projEnds.s, b, END_TOL_SEC);
    if (sa != null && sb != null) nullRanges.push([sa, sb]);
  }
  // A line one of the two laps never located is a line neither reading can be checked at, and a
  // line is exactly where the delta is read off. Blanked on the road rather than in either lap's
  // own clock: what is in doubt near such a line is precisely where the other lap's moment lands
  // on the road (measured 2026-09-07 — two such readings sat 0.30 s out, while every reading at a
  // located line on the same footage was inside 0.09 s).
  const unchecked = new Set([...unlocatedLines(base), ...unlocatedLines(other)]);
  // What goes is the line BETWEEN the crossings; the readings at the crossings themselves stay,
  // because they are two measured moments subtracted and the projection has no part in them.
  const untrustedRanges: Array<[number, number]> = guessed;
  if (unchecked.size) {
    const lineTimes: Array<[string, number]> = [];
    for (const seg of base.segments) {
      if (!lineTimes.length) lineTimes.push([seg.fromKey, seg.fromT]);
      lineTimes.push([seg.toKey, seg.toT]);
    }
    for (const [key, t] of lineTimes) {
      if (!unchecked.has(key)) continue;
      const sa = interpNear(roadEnds.t, roadEnds.s, t - UNPINNED_BLANK_SEC, END_TOL_SEC);
      const sb = interpNear(roadEnds.t, roadEnds.s, t + UNPINNED_BLANK_SEC, END_TOL_SEC);
      if (sa != null && sb != null) nullRanges.push([sa, sb]);
    }
  }
  const inHole = (s: number) => nullRanges.some(([a, b]) => s > a && s < b);
  const lapLen = lapTo - lapFrom;
  /**
   * Distance along the road for a share of the lap, and back. Held inside the road's own ends:
   * `lapFrom + 1 * lapLen` can land an ulp past `lapTo`, which reads as off the end of the path and
   * costs the lap its last sample — the total, which is the one number on the chart a driver
   * looks at first.
   */
  const roadAt = (f: number) => Math.max(lapFrom, Math.min(lapTo, lapFrom + f * lapLen));
  const shareOf = (sRoad: number | null) => (sRoad == null || lapLen <= 0 ? null : (sRoad - lapFrom) / lapLen);

  const sign = opts.baseIsYou ? 1 : -1;
  const baseTimeOfS = (s: number) => interp(roadEnds.s, roadEnds.t, roadAt(s));
  const otherTimeOfS = (s: number) => interp(projEnds.s, projEnds.t, roadAt(s));
  const at = (s: number): number | null => {
    const tb = baseTimeOfS(s);
    const to = otherTimeOfS(s);
    if (tb == null || to == null || inHole(roadAt(s))) return null;
    return sign * (tb - base.startSec - (to - other.startSec));
  };
  // Where the lines fall on the road, needed before the samples are judged: at a line both laps'
  // moments are known from the crossing scan rather than guessed, and the projection is pulled
  // onto it, which shows up as a step in pace that is the checkpoint and not the driving.
  const ticks: DeltaTick[] = [];
  for (const seg of base.segments) {
    const share = shareOf(interpNear(roadEnds.t, roadEnds.s, seg.toT, END_TOL_SEC));
    if (share != null) ticks.push({ lineKey: seg.toKey, s: share });
  }

  const samples: DeltaSample[] = [];
  const baseAt: Array<number | null> = [];
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    samples.push({ s, delta: lapLen > 0 ? at(s) : null });
    baseAt.push(lapLen > 0 ? baseTimeOfS(s) : null);
  }
  // Two rules throw readings away, and they share one exemption at the lines below: a stretch
  // the projection could not find its own way through, and a stretch the line makes impossible.
  // The second is the other lap's moment in the wrong place, not a reading; the whole window
  // goes, because the error is spread across it rather than sitting at one end.
  const drop = new Uint8Array(N + 1);
  for (const [a2, b2] of untrustedRanges) {
    for (let k = 0; k <= N; k++) {
      const sr = roadAt(k / N);
      if (sr > a2 && sr < b2) drop[k] = 1;
    }
  }
  const lapSec = Math.max(0.5, base.endSec - base.startSec);
  const window = Math.max(2, Math.round(N * (PACE_WINDOW_SEC / lapSec)));
  // Neighbour to neighbour first: a leap that comes straight back nets out across the window
  // below and would otherwise survive it.
  for (let k = 1; k <= N; k++) {
    const a = samples[k - 1]!.delta;
    const b = samples[k]!.delta;
    const ta = baseAt[k - 1];
    const tb2 = baseAt[k];
    if (a == null || b == null || ta == null || tb2 == null) continue;
    const dtb = Math.max(SPIKE_MIN_STEP_SEC, tb2 - ta);
    const dto = dtb - (b - a);
    const ratio = dto <= 0 ? Infinity : Math.max(dto / dtb, dtb / dto);
    if (ratio > SPIKE_RATIO_MAX) {
      drop[k - 1] = 1;
      drop[k] = 1;
    }
  }
  for (let k = window; k <= N; k++) {
    const a = samples[k - window]!.delta;
    const b = samples[k]!.delta;
    const ta = baseAt[k - window];
    const tb2 = baseAt[k];
    if (a == null || b == null || ta == null || tb2 == null) continue;
    const dtb = tb2 - ta;
    if (dtb <= 1e-4) continue;
    // What the line says the other lap took over the same stretch of road.
    const dto = dtb - (b - a);
    const ratio = dto <= 0 ? Infinity : Math.max(dto / dtb, dtb / dto);
    if (ratio <= PACE_RATIO_MAX) continue;
    const from = samples[k - window]!.s;
    const to2 = samples[k]!.s;
    for (let q = k - window; q <= k; q++) drop[q] = 1;
  }
  // Only the lines the projection was actually pinned to. A line withheld from it (the harness
  // does this, one at a time) has no measured moment behind its reading any more, so it is judged
  // like anywhere else on the road — which is what makes withholding it a real test.
  const pinnedKeys = new Set(cps.map((c) => c.lineKey));
  for (const t of ticks) {
    if (!pinnedKeys.has(t.lineKey)) continue;
    const at = Math.round(t.s * N);
    for (let q = Math.max(0, at - PACE_KEEP_AT_LINE); q <= Math.min(N, at + PACE_KEEP_AT_LINE); q++) drop[q] = 0;
  }
  for (let k = 0; k <= N; k++) if (drop[k]) samples[k]!.delta = null;
  return {
    samples,
    ticks,
    total: lapLen > 0 ? at(1) : null,
    sOfBaseTime: (t) => shareOf(interpNear(roadEnds.t, roadEnds.s, t, END_TOL_SEC)),
    sOfOtherTime: (t) => shareOf(interpNear(projEnds.t, projEnds.s, t, END_TOL_SEC)),
    baseTimeOfS,
    otherTimeOfS,
  };
}

export type ConsistencyRow = {
  lineKey: string;
  /** The curve at that line's tick. */
  curve: number | null;
  /** The board's cumulative delta to that line, you minus them. */
  board: number;
  /** Curve minus board; null when the curve has a hole there. */
  diff: number | null;
};

/**
 * The curve against the sector board at every line: the two were measured independently, so
 * this is the check that costs nothing. Rows further apart than `toleranceSec` are the ones the
 * screen should own up to.
 */
export function consistencyCheck(
  curve: DeltaCurve,
  board: Array<{ lineKey: string; youMinusThem: number }>,
  toleranceSec: number
): { rows: ConsistencyRow[]; disagreeing: ConsistencyRow[] } {
  const rows: ConsistencyRow[] = [];
  for (const b of board) {
    const tick = curve.ticks.find((t) => t.lineKey === b.lineKey);
    if (!tick) continue;
    const c = readingAt(curve.samples, tick.s);
    rows.push({ lineKey: b.lineKey, curve: c, board: b.youMinusThem, diff: c == null ? null : c - b.youMinusThem });
  }
  return { rows, disagreeing: rows.filter((r) => r.diff != null && Math.abs(r.diff) > toleranceSec) };
}

/**
 * The curve at one place — but only where it is a reading rather than the lip of a gap. A single
 * drawn sample with a hole against it comes from one stray point at the edge of a stretch nobody
 * followed, and that is where the biggest errors sat before this rule (2026-09-06).
 */
function readingAt(samples: DeltaSample[], s: number): number | null {
  let at = -1;
  for (let i = 0; i < samples.length; i++) {
    if (at < 0 || Math.abs(samples[i]!.s - s) < Math.abs(samples[at]!.s - s)) at = i;
  }
  if (at < 0 || samples[at]!.delta == null) return null;
  const before = samples[Math.max(0, at - 1)]!.delta;
  const after = samples[Math.min(samples.length - 1, at + 1)]!.delta;
  return before == null || after == null ? null : samples[at]!.delta;
}
