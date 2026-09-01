/**
 * Follow the moving things across a window, instead of judging each frame pair alone.
 *
 * The detector's core measurement — which side of the line is the nearest moving blob on — has
 * no memory. Every frame pair is a fresh opinion, and that is where its two failure modes come
 * from:
 *
 *   - A **phantom flip**. Blob A sits just before the line, blob B just after. If B is briefly
 *     the nearer of the two, the trace flips sign and reports a crossing, though nothing crossed
 *     anything. This is why a window over kerbing throws up a dozen candidate events.
 *   - A **pinned sign**. Something on one side of the line stays nearer than the car for the
 *     whole pass, so the trace never flips at all and the crossing is reported as not found.
 *     That is what most of the remaining misses look like.
 *
 * Both dissolve once the blobs are linked frame to frame. A car is a thing that persists, moves
 * steadily, and covers ground; codec noise appears and vanishes in place, and a marshal's boot
 * wanders. Straightness — net displacement divided by the wandering path length — separates them
 * without needing to know how fast the car is going, which matters because at a hairpin it is
 * barely moving.
 *
 * This is deliberately NOT the lap tracer from `VIDEO_TRACE_NORTH_STAR.md` phase 5. It follows
 * things for half a second inside a window the detector already decodes, needs no metric
 * calibration, and produces no path for display. It is a filter on the existing measurement.
 */

import type { Rgb } from "./carColour";

/** One moving blob seen in one frame, positioned in full-frame coords. */
export type BlobObs = {
  x: number;
  y: number;
  area: number;
  /** Signed distance to the line — the sign is which side. */
  signed: number;
  /** Mean colour around this blob, when the frame was read in colour. See `carColour.ts`. */
  colour?: Rgb;
};

/** Everything that moved in one frame. */
export type FrameObs = { t: number; blobs: BlobObs[] };

export type TrackPoint = { t: number; x: number; y: number; signed: number; colour?: Rgb };

export type Track = {
  points: TrackPoint[];
  /** Straight-line distance from first point to last, in pixels. */
  netTravel: number;
  /** Sum of every step, in pixels. Always >= netTravel. */
  pathLength: number;
  /** netTravel / pathLength over the WHOLE track: a corner scores low, and that is correct. */
  straightness: number;
  /** Seconds from first point to last. */
  duration: number;
  /** Persisted long enough to be worth reading. Coherence is judged per crossing, not here. */
  carLike: boolean;
};

/**
 * The shared drift of everything in the band between consecutive frames — how far a blob moved
 * on average, when it can be matched to one nearby in the previous frame.
 *
 * Deliberately crude. It needs to say "the camera moved this way" and no more; a single car
 * driving through a still frame contributes one vote among many stationary ones and barely shifts
 * the answer, while a shaken frame has every blob voting the same way.
 */
export function frameMotions(frames: FrameObs[], maxStepPx: number): FrameMotion[] {
  const out: FrameMotion[] = [];
  for (let f = 1; f < frames.length; f++) {
    const prev = frames[f - 1];
    const cur = frames[f];
    let dx = 0;
    let dy = 0;
    let n = 0;
    for (const b of cur.blobs) {
      let best: BlobObs | null = null;
      let bestD = maxStepPx;
      for (const p of prev.blobs) {
        const d = dist(b.x, b.y, p.x, p.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best) continue;
      dx += b.x - best.x;
      dy += b.y - best.y;
      n++;
    }
    out.push({ t: cur.t, dx: n ? dx / n : 0, dy: n ? dy / n : 0, n });
  }
  return out;
}

/** A sign change within a single track — one object, genuinely crossing. */
export type TrackCrossing = {
  t: number;
  /** Index into the track list it came from. */
  trackIndex: number;
  /** Observations in the track that produced it. */
  support: number;
  /** How coherently the object was moving in the moments either side of this crossing. */
  straightness: number;
  /** Pixels covered in that same short window. */
  travelPx: number;
  /** Which side of the line it ended on — see CrossingEvent.dir. */
  dir: 1 | -1;
  /**
   * Share of the object's movement that was its own rather than the whole frame's, 0..1.
   * Null when the frame held nothing else to compare against.
   */
  ownMotion: number | null;
  /** Mean colour of the object as it crossed, when the frame was read in colour. */
  colour?: Rgb;
  /** Where it crossed, in frame pixels — so the moment can be shown, not just described. */
  x: number;
  y: number;
};

/**
 * The whole frame moving at once, between two moments.
 *
 * A gust nudges the camera and every bit of paint in shot drifts the same way for a few frames.
 * Each of those drifts is short, straight and coherent — it passes the "moves like a car" test
 * MORE convincingly than a car cornering does. The tell is that it is not one thing moving but
 * everything, in step. So the frame's common motion is measured from every blob in it, and a
 * crossing is only believed when the object moved differently from that background.
 */
export type FrameMotion = { t: number; dx: number; dy: number; n: number };

export type TrackerConfig = {
  /**
   * How far a blob may move per second and still be the same object. Generous on purpose —
   * a gate tight enough to reject noise would also break a real car on a fast straight, and
   * the quality tests below do the rejecting far more reliably than a distance cap can.
   */
  maxSpeedPxPerSec: number;
  /** A track survives this long without a matching blob before it is closed off. */
  maxGapSec: number;
  /** Fewest observations before a track can be believed. */
  minPoints: number;
  /** Observations either side of a crossing that its coherence is judged over. */
  localHalfWindow: number;
  /** Lowest net/path ratio, measured over that short window only. */
  minStraightness: number;
  /** Least ground covered over that short window, in pixels. */
  minTravelPx: number;
  /**
   * How much of the object's movement must be its OWN, after the frame's shared movement is taken
   * out. 1 means the object moved entirely on its own; 0 means it moved exactly with the frame.
   */
  minOwnMotion: number;
};

/**
 * Defaults are expressed against the band half-width, so they hold at any resolution and any
 * line length rather than being tuned to one video.
 *
 * **Coherence is local.** Judging it over a whole track is the mistake that cost the far corner:
 * the car there is one clean 38-point track that crosses within 16ms of the hand mark, and over
 * its full 1.33 seconds it scores 0.37 — because it is going round a corner, which is what a
 * sector line is drawn across. Over a fifth of a second the same car is nearly straight. Codec
 * noise and shimmer are not straight over any window at all, so nothing is given away.
 *
 * `minTravelPx` is small for the same reason. A car at the far end of the track covers few
 * pixels however fast it is going, and a crossing already requires the object to change sides —
 * this bar only has to exclude something sitting on the line twitching.
 */
export function defaultTrackerConfig(bandHalfPx: number): TrackerConfig {
  return {
    maxSpeedPxPerSec: bandHalfPx * 45,
    maxGapSec: 0.12,
    minPoints: 4,
    localHalfWindow: 3,
    minStraightness: 0.6,
    minTravelPx: bandHalfPx * 0.12,
    minOwnMotion: 0.5,
  };
}

type Open = {
  points: TrackPoint[];
  lastT: number;
  vx: number;
  vy: number;
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Link blobs into tracks, greedily nearest-first, allowing a few dropped frames.
 *
 * Greedy assignment rather than an optimal one: with a handful of blobs per frame the two agree
 * almost always, and where they differ the quality tests downstream discard the difference.
 */
export function buildTracks(frames: FrameObs[], cfg: TrackerConfig): Track[] {
  const open: Open[] = [];
  const closed: Open[] = [];

  for (const frame of frames) {
    // Retire anything that has gone quiet, so it cannot claim a blob much later.
    for (let i = open.length - 1; i >= 0; i--) {
      if (frame.t - open[i].lastT > cfg.maxGapSec) closed.push(...open.splice(i, 1));
    }

    // Every plausible pairing, nearest first. A blob and a track are plausible if the blob is
    // within reach of where the track's speed says it should have got to.
    const pairs: Array<{ t: number; b: number; d: number }> = [];
    for (let ti = 0; ti < open.length; ti++) {
      const tr = open[ti];
      const dt = frame.t - tr.lastT;
      if (dt <= 0) continue;
      const last = tr.points[tr.points.length - 1];
      const px = last.x + tr.vx * dt;
      const py = last.y + tr.vy * dt;
      const reach = cfg.maxSpeedPxPerSec * dt;
      for (let bi = 0; bi < frame.blobs.length; bi++) {
        const blob = frame.blobs[bi];
        // Measured from where it was, so a track with no velocity yet is not penalised;
        // the prediction only breaks ties.
        if (dist(last.x, last.y, blob.x, blob.y) > reach) continue;
        pairs.push({ t: ti, b: bi, d: dist(px, py, blob.x, blob.y) });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    const usedTrack = new Set<number>();
    const usedBlob = new Set<number>();
    for (const p of pairs) {
      if (usedTrack.has(p.t) || usedBlob.has(p.b)) continue;
      usedTrack.add(p.t);
      usedBlob.add(p.b);
      const tr = open[p.t];
      const blob = frame.blobs[p.b];
      const last = tr.points[tr.points.length - 1];
      const dt = frame.t - tr.lastT;
      tr.vx = (blob.x - last.x) / dt;
      tr.vy = (blob.y - last.y) / dt;
      tr.points.push({ t: frame.t, x: blob.x, y: blob.y, signed: blob.signed, colour: blob.colour });
      tr.lastT = frame.t;
    }

    // Anything unclaimed starts its own track — a car entering the band has to begin somewhere.
    for (let bi = 0; bi < frame.blobs.length; bi++) {
      if (usedBlob.has(bi)) continue;
      const blob = frame.blobs[bi];
      open.push({
        points: [{ t: frame.t, x: blob.x, y: blob.y, signed: blob.signed, colour: blob.colour }],
        lastT: frame.t,
        vx: 0,
        vy: 0,
      });
    }
  }

  return [...closed, ...open].map((o) => finish(o.points, cfg));
}

function finish(points: TrackPoint[], cfg: TrackerConfig): Track {
  let pathLength = 0;
  for (let i = 1; i < points.length; i++) {
    pathLength += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  const first = points[0];
  const last = points[points.length - 1];
  const netTravel = dist(first.x, first.y, last.x, last.y);
  const straightness = pathLength > 0 ? netTravel / pathLength : 0;
  const duration = last.t - first.t;
  return {
    points,
    netTravel,
    pathLength,
    straightness,
    duration,
    carLike: points.length >= cfg.minPoints,
  };
}

/**
 * How much of this object's movement, over the frames around index `i`, was NOT the frame's.
 *
 * Each step the object took is compared with the frame's shared drift at that same instant. The
 * shared part is subtracted; what is left is the object's own. Returns the ratio own/total, or
 * null when no step had a background to compare against — the frame was empty apart from this,
 * which is the one-car practice case, where there is no shake to reject and nothing to lose.
 *
 * Only frames with at least three other blobs count as background. One other blob is not a
 * background, it is another car.
 */
const MIN_BACKGROUND_BLOBS = 3;

function ownMotionAround(
  points: TrackPoint[],
  i: number,
  half: number,
  motionAt: Map<number, FrameMotion>
): number | null {
  const from = Math.max(1, i - half);
  const to = Math.min(points.length - 1, i + half);
  let total = 0;
  let own = 0;
  let judged = 0;
  for (let k = from; k <= to; k++) {
    const m = motionAt.get(points[k].t);
    if (!m || m.n < MIN_BACKGROUND_BLOBS) continue;
    const sx = points[k].x - points[k - 1].x;
    const sy = points[k].y - points[k - 1].y;
    total += Math.hypot(sx, sy);
    own += Math.hypot(sx - m.dx, sy - m.dy);
    judged++;
  }
  if (!judged || total === 0) return null;
  return Math.min(1, own / total);
}

/** net/path and net distance over the points either side of index `i`. */
function localMotion(points: TrackPoint[], i: number, half: number) {
  const from = Math.max(0, i - half);
  const to = Math.min(points.length - 1, i + half);
  let path = 0;
  for (let k = from + 1; k <= to; k++) {
    path += dist(points[k - 1].x, points[k - 1].y, points[k].x, points[k].y);
  }
  const net = dist(points[from].x, points[from].y, points[to].x, points[to].y);
  return { net, path, straightness: path > 0 ? net / path : 0, count: to - from + 1 };
}

/**
 * Where a track changes side. Because this is one object followed through, a sign change here
 * means that object crossed the line — it cannot be two blobs swapping places.
 *
 * Interpolated the same way as the frame-pair events, so the two are directly comparable.
 */
export function trackCrossings(
  tracks: Track[],
  cfg: TrackerConfig,
  filter = true,
  motions: FrameMotion[] = []
): TrackCrossing[] {
  const out: TrackCrossing[] = [];
  const motionAt = new Map(motions.map((m) => [m.t, m]));
  tracks.forEach((track, trackIndex) => {
    if (filter && !track.carLike) return;
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1];
      const b = track.points[i];
      if (a.signed === 0 || b.signed === 0) continue;
      if (a.signed < 0 === b.signed < 0) continue;

      const local = localMotion(track.points, i, cfg.localHalfWindow);
      if (
        filter &&
        (local.count < cfg.minPoints ||
          local.straightness < cfg.minStraightness ||
          local.net < cfg.minTravelPx)
      ) {
        continue;
      }

      const ownMotion = ownMotionAround(track.points, i, cfg.localHalfWindow, motionAt);
      if (filter && ownMotion != null && ownMotion < cfg.minOwnMotion) continue;

      const frac = Math.abs(a.signed) / (Math.abs(a.signed) + Math.abs(b.signed));
      out.push({
        dir: b.signed > 0 ? 1 : -1,
        t: a.t + frac * (b.t - a.t),
        trackIndex,
        support: track.points.length,
        straightness: local.straightness,
        travelPx: local.net,
        ownMotion,
        colour: a.colour ?? b.colour,
        x: a.x + frac * (b.x - a.x),
        y: a.y + frac * (b.y - a.y),
      });
    }
  });
  return out;
}
