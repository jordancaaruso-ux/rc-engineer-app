/**
 * The drawn line, from the measured points.
 *
 * A motion blob's centre jitters by a fraction of a car length from frame to frame, and a line
 * drawn straight through the raw points looks like a nervous hand. For the picture the points are
 * averaged over a short window of time — short enough that a hairpin keeps its shape. The delta
 * maths reads the raw points; only the drawing is smoothed.
 *
 * Nothing is averaged across a hole. A gap in time splits the line into runs, and each run is
 * smoothed on its own, so the smoothed line never reaches into a stretch the tracer did not see.
 */

import type { TracePoint } from "@/lib/manualVideoAnalysis/types";

/** Half the averaging window, in seconds — about two frames either side at 30fps. */
export const SMOOTH_HALF_SEC = 0.075;
/** Consecutive points further apart than this are different runs. */
export const RUN_BREAK_SEC = 0.25;

/** Split a point list into runs at every gap wider than `breakSec`. */
export function splitRuns(points: TracePoint[], breakSec = RUN_BREAK_SEC): TracePoint[][] {
  const runs: TracePoint[][] = [];
  let cur: TracePoint[] = [];
  for (const p of points) {
    if (cur.length && p[0] - cur[cur.length - 1]![0] > breakSec) {
      runs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** The same points, positions averaged over ±`halfSec`, one list per unbroken run. */
export function smoothForDisplay(
  points: TracePoint[],
  halfSec = SMOOTH_HALF_SEC,
  breakSec = RUN_BREAK_SEC
): TracePoint[][] {
  return splitRuns(points, breakSec).map((run) => {
    const out: TracePoint[] = [];
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < run.length; i++) {
      const t = run[i]![0];
      while (run[lo]![0] < t - halfSec) lo++;
      while (hi < run.length && run[hi]![0] <= t + halfSec) hi++;
      let sx = 0;
      let sy = 0;
      for (let k = lo; k < hi; k++) {
        sx += run[k]![1];
        sy += run[k]![2];
      }
      const n = hi - lo;
      out.push([t, sx / n, sy / n, run[i]![3], run[i]![4]]);
    }
    return out;
  });
}
