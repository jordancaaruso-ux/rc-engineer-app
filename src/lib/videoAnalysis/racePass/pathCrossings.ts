/**
 * Where a followed path went over a drawn line, and when — to better than a frame.
 *
 * This is the measurement the whole race pass exists to make, and it is a different question from
 * the one the strip detector asks. The strip watches a band of pixels and reports the moment
 * something in it changed sides; it cannot say what that something was, which is how a person
 * standing at the tip of a hairpin line ends up competing with a car. Here the path is already
 * one object's, so a crossing is simply where that object's own line of travel meets the line the
 * driver drew — and the answer is interpolated between two sightings rather than rounded to
 * whichever frame noticed, which is the difference between about 5 ms and 33 ms.
 *
 * **Strict to the drawn ends.** The intersection has to fall inside the segment (`u` in 0..1), not
 * on the infinite line through it. That is the "a line ends where it is drawn" ruling, and it is
 * the mechanism behind the Bendigo lap 5 fault this rebuild exists for: the strip's band reaches
 * past the line's end, so a car passing wide of the corner registered while the driver's own pass
 * did not.
 *
 * **A crossing over a hole is not a crossing.** If the two sightings either side of the line are
 * far apart in time, the object was not seen going over it — the straight line between them is an
 * assumption, and where it meets the drawn line is an assumption about a moment. Those come back
 * marked, and the caller decides; nothing here quietly bridges.
 *
 * Pure geometry: points and a line in, moments out.
 */

import { lineGeom, signedDistance, type LineGeom } from "../findCrossings/geometry";
import type { SectorLine } from "../findCrossings/types";
import type { Obs } from "../trace/chain";

/**
 * Longest gap between two sightings that still counts as watching something cross.
 *
 * At 30 fps a fifth of a second is six frames. Beyond that the object was out of sight for long
 * enough to have gone somewhere else and come back, and a straight line through the gap is a
 * story rather than a measurement.
 */
export const MAX_STEP_SEC = 0.2;

/** Two crossings of one line closer together than this are one pass seen twice. */
export const SAME_PASS_SEC = 0.2;

/**
 * How far past a line's drawn end the car's own middle may pass and still have crossed it, as a
 * share of the car's own length at that moment.
 *
 * **A path is made of blob centres, and a car is not a point.** On the Boronia race the drawn
 * corner lines measure 16, 18, 40 and 45 pixels against a car of 56 — three of the five are
 * shorter than a third of the car. A driver drawing across a corner forty metres away draws what
 * the track looks like there, which is a few pixels; the car still covers all of it and more. Ask
 * whether the *centre* passed through those sixteen pixels and the answer is almost always no:
 * measured 2026-09-08, 301 of 310 crossings came back missing while the same paths crossed the
 * start line — a 168-pixel line — on 62 laps out of 64.
 *
 * So the test is the car's body: its middle may pass up to half its own length beyond either end.
 * Half a car, not a share of the line's length. That distinction is the whole point — the strip
 * detector extends every line by **half its own length** either way (`ROI_LINE_EXTEND`), which on a
 * short line is a huge reach and is exactly how a car running wide of a corner registered as
 * crossing it while the driver's own pass did not. Half a car is a fact about the car; it does not
 * grow when the line is long or shrink when it is short.
 *
 * Measured against the car SEEN at that moment, never a global figure: at the far end of a track
 * the same car is a quarter the size, and a tolerance taken from the near end would reach four
 * times too far exactly where the lines are shortest.
 */
export const END_TOLERANCE_CAR_LENGTHS = 0.5;

export type PathCrossing = {
  /** Video time, interpolated between the two sightings either side. */
  t: number;
  /** Where on the line it went over, full-frame pixels. */
  x: number;
  y: number;
  /** Which side it ended on — the sign of the line's signed distance, as `CrossingEvent.dir`. */
  dir: 1 | -1;
  /** Index of the sighting before the crossing, into the points given. */
  index: number;
  /** How far apart in time the two sightings either side were. */
  stepSec: number;
  /**
   * The object was actually watched going over: the two sightings either side are close enough
   * in time to be consecutive frames rather than the two ends of a gap.
   */
  solid: boolean;
};

/**
 * Every time this path goes over this line segment.
 *
 * A hairpin's line is crossed twice a lap in opposite directions and both come back; deciding
 * which one is the corner the driver meant is a question about track order, not geometry, and it
 * is answered in `sectorCrossings`.
 */
export function pathCrossings(
  points: ReadonlyArray<Obs>,
  line: SectorLine,
  frameW: number,
  frameH: number,
  opts: { maxStepSec?: number } = {}
): PathCrossing[] {
  const g = lineGeom(line, frameW, frameH);
  return crossingsAgainst(points, g, opts.maxStepSec ?? MAX_STEP_SEC);
}

/** The same, for a line whose geometry has already been worked out. */
export function crossingsAgainst(
  points: ReadonlyArray<Obs>,
  g: LineGeom,
  maxStepSec = MAX_STEP_SEC,
  endToleranceCarLengths = END_TOLERANCE_CAR_LENGTHS
): PathCrossing[] {
  const out: PathCrossing[] = [];
  const ax = g.p1x;
  const ay = g.p1y;
  const qx = g.dx;
  const qy = g.dy;
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1]!;
    const p2 = points[i]!;
    const stepSec = p2.t - p1.t;
    if (!(stepSec > 0)) continue;
    const rx = p2.x - p1.x;
    const ry = p2.y - p1.y;
    const den = rx * qy - ry * qx;
    // Parallel, or a step that went nowhere: no single moment to report.
    if (Math.abs(den) < 1e-9) continue;
    const wx = ax - p1.x;
    const wy = ay - p1.y;
    const t = (wx * qy - wy * qx) / den;
    const u = (wx * ry - wy * rx) / den;
    if (t < 0 || t > 1) continue;
    // How far beyond the drawn end the crossing point sits, in pixels — and how much of the car
    // is available to cover that. The path is the car's MIDDLE, so half a car either way still
    // means the car went over the line. Measured against the car seen right here, because the
    // same car is a quarter the size at the far end of the track.
    const beyond = Math.max(0, -u, u - 1) * g.norm;
    if (beyond > 0) {
      const carHere = Math.max(p1.w, p1.h, p2.w, p2.h);
      if (beyond > endToleranceCarLengths * carHere) continue;
    }
    const at = p1.t + stepSec * t;
    // One pass, seen twice — a blob's centre jittering across the line — is not two crossings.
    if (out.some((o) => Math.abs(o.t - at) < SAME_PASS_SEC)) continue;
    const x = p1.x + rx * t;
    const y = p1.y + ry * t;
    const ended = signedDistance(g, p2.x, p2.y);
    out.push({
      t: at,
      x,
      y,
      dir: ended > 0 ? 1 : -1,
      index: i - 1,
      stepSec,
      solid: stepSec <= maxStepSec,
    });
  }
  return out;
}

/** The full-resolution strip's opinion of the same line, to pin a path crossing to the frame. */
export type StripCandidate = {
  t: number;
  quality: number;
  x?: number;
  y?: number;
  dir?: 1 | -1;
  source?: "confirmed" | "rescued" | "unconfirmed";
};

/** How the moment was arrived at. `confirmed` means the strip saw it too, at the same place. */
export type CrossingSource = "confirmed" | "rescued";

export type SnappedCrossing = PathCrossing & {
  source: CrossingSource;
  /** The strip's own moment where there was one — this is what `t` becomes when it snaps. */
  snappedToSec: number | null;
  quality: number | null;
};

/**
 * How far from a path's own answer the strip's may sit and still be the same crossing.
 *
 * Four frames at 30 fps. The two are measuring the same event by different means — one from the
 * blob's centre, one from a band of pixels changing sides — and on the graded footage they agree
 * to a couple of hundredths where both saw it. Wider than this and it is a different pass.
 */
export const SNAP_SEC = 0.12;

/** …and no further away on the picture than this many car lengths. */
export const SNAP_CAR_LENGTHS = 1;

/**
 * Pin a path's crossing to the strip detector's, when the strip found the same one.
 *
 * The path says **which** object crossed, which the strip can never know. The strip says **when**,
 * from the full-resolution picture rather than a quarter-scale one, which the path can only
 * approximate. Snapping takes the better half of each. Where the strip has nothing — the car was
 * too faint for its band, or it is a line the strip never read — the path's own moment stands and
 * is marked `rescued`, the label that already means "only the tracking saw this".
 */
export function snapToStrip(
  crossings: ReadonlyArray<PathCrossing>,
  candidates: ReadonlyArray<StripCandidate>,
  carPx: number,
  opts: { snapSec?: number; snapCarLengths?: number } = {}
): SnappedCrossing[] {
  const snapSec = opts.snapSec ?? SNAP_SEC;
  const bar = (opts.snapCarLengths ?? SNAP_CAR_LENGTHS) * carPx;
  const taken = new Set<number>();
  return crossings.map((c) => {
    let best: { i: number; cand: StripCandidate; d: number } | null = null;
    for (let i = 0; i < candidates.length; i++) {
      if (taken.has(i)) continue;
      const cand = candidates[i]!;
      const dt = Math.abs(cand.t - c.t);
      if (dt > snapSec) continue;
      // A candidate that carries a position must be at the same place on the line, not merely at
      // the same moment: on a busy line two cars go over within a frame of each other.
      if (cand.x != null && cand.y != null && Math.hypot(cand.x - c.x, cand.y - c.y) > bar) continue;
      if (!best || dt < best.d) best = { i, cand, d: dt };
    }
    if (!best) {
      return { ...c, source: "rescued" as const, snappedToSec: null, quality: null };
    }
    taken.add(best.i);
    return {
      ...c,
      t: best.cand.t,
      x: best.cand.x ?? c.x,
      y: best.cand.y ?? c.y,
      dir: best.cand.dir ?? c.dir,
      source: "confirmed" as const,
      snappedToSec: best.cand.t,
      quality: best.cand.quality,
    };
  });
}
