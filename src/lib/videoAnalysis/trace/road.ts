/**
 * Where the track goes, learnt from laps already followed.
 *
 * When the tracer loses the car it carries the last heading forward and, near the next crossing,
 * leans on that. Over a long stretch neither is worth much: a heading a second old says nothing
 * about a corner, and the crossing is still seconds away. On the Bendigo fisheye that left the
 * window parked seven hundred pixels off the road for most of a sector while the car went by
 * unseen, and what it caught there instead was a marshal standing still (2026-09-07).
 *
 * But the track does not move, and every car on it drives roughly the same line. Measured across
 * the grading set on the same day: in every stretch that was followed properly, the laps ran
 * within 0.2 to 2.1 car lengths of each other at the same point of the stretch. So a lap that WAS
 * followed knows where to look, and a session usually holds one — the far sector that lost the
 * car on one lap was traced through 97 % of its frames on another.
 *
 * Only laps the tracer vouched for are learnt from, and only their stretches that were followed
 * through more than half their frames with no hole in them.
 *
 * This is only ever a place to point the window. Nothing here can put a car in the path: the
 * chain still has to find a real moving thing and pay for the step. A wrong road aims the window
 * badly, which is what dead reckoning was already doing.
 */

import type { ManualLapTrace, TraceSegment } from "@/lib/manualVideoAnalysis/types";

/** Positions are sampled at this many shares of a stretch, ends included. */
export const ROAD_STEPS = 24;
/**
 * A stretch is only worth learning from if the car was placed in this share of its frames. The
 * same bar the delta line uses before it will read a sector at all.
 */
export const ROAD_MIN_COVERAGE = 0.55;
/** And at least this many laps must agree, so one bad path cannot become the road. */
export const ROAD_MIN_LAPS = 1;

export type RoadPoint = { x: number; y: number };

export type Road = {
  /** Where the car was at `frac` of the stretch between two lines, in frame pixels. */
  at(fromKey: string, toKey: string, frac: number): RoadPoint | null;
  /** Which stretches were learnt, for the log. */
  readonly stretches: string[];
};

const key = (from: string, to: string) => `${from}→${to}`;

/** The middle of a set of numbers. */
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/** Does a hole overlap this stretch at all? A stretch with one is not a path through it. */
function holed(trace: ManualLapTrace, seg: TraceSegment): boolean {
  return trace.holes.some((h) => h.toT > seg.fromT && h.fromT < seg.toT);
}

/**
 * Where a trace put the car at a moment, from its own points. Null past either end of them —
 * the points are what the tracer actually saw, and nothing is invented between stretches.
 */
function atTime(trace: ManualLapTrace, t: number, w: number, h: number): RoadPoint | null {
  const p = trace.points;
  if (p.length < 2 || t < p[0]![0] || t > p[p.length - 1]![0]) return null;
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid]![0] <= t) lo = mid;
    else hi = mid;
  }
  const span = p[hi]![0] - p[lo]![0];
  const k = span > 0 ? (t - p[lo]![0]) / span : 0;
  return {
    x: (p[lo]![1] + (p[hi]![1] - p[lo]![1]) * k) * w,
    y: (p[lo]![2] + (p[hi]![2] - p[lo]![2]) * k) * h,
  };
}

/**
 * The road from every stretch these traces followed cleanly, in the frame size given.
 *
 * A stretch is sampled at even shares of its own time rather than its own length, because that
 * is what the caller can ask for: it knows the two crossings' moments and the moment it is
 * reading, and nothing else. Laps are combined by taking the middle of them at each share, so one
 * path that went with the wrong car cannot drag the road off the track.
 */
export function roadFrom(traces: ManualLapTrace[], frame: { w: number; h: number }): Road {
  const byStretch = new Map<string, Array<Array<RoadPoint | null>>>();
  for (const trace of traces) {
    if (!trace.quality.ok) continue;
    for (const seg of trace.segments) {
      if (seg.coverage < ROAD_MIN_COVERAGE || holed(trace, seg)) continue;
      if (!(seg.toT > seg.fromT)) continue;
      const row: Array<RoadPoint | null> = [];
      for (let s = 0; s <= ROAD_STEPS; s++) {
        row.push(atTime(trace, seg.fromT + ((seg.toT - seg.fromT) * s) / ROAD_STEPS, frame.w, frame.h));
      }
      const k = key(seg.fromKey, seg.toKey);
      byStretch.set(k, [...(byStretch.get(k) ?? []), row]);
    }
  }

  const road = new Map<string, Array<RoadPoint | null>>();
  for (const [k, rows] of byStretch) {
    if (rows.length < ROAD_MIN_LAPS) continue;
    const line: Array<RoadPoint | null> = [];
    for (let s = 0; s <= ROAD_STEPS; s++) {
      const pts = rows.map((r) => r[s]).filter((p): p is RoadPoint => p != null);
      line.push(pts.length ? { x: median(pts.map((p) => p.x)), y: median(pts.map((p) => p.y)) } : null);
    }
    road.set(k, line);
  }

  return {
    stretches: [...road.keys()],
    at(fromKey, toKey, frac) {
      const line = road.get(key(fromKey, toKey));
      if (!line) return null;
      const f = Math.max(0, Math.min(1, frac)) * ROAD_STEPS;
      const lo = Math.min(ROAD_STEPS - 1, Math.floor(f));
      const a = line[lo];
      const b = line[lo + 1];
      if (!a || !b) return a ?? b ?? null;
      const k = f - lo;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    },
  };
}
