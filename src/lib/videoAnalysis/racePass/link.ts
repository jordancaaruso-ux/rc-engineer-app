/**
 * Moving things, frame after frame, joined into the paths they traced.
 *
 * This is the step between "something moved here" and "this is somebody's car". It does not know
 * who anything is and must not guess: naming happens afterwards, from the timing sheet
 * (`name.ts`). All this has to do is join sightings that are plainly the same object, and — the
 * part that matters — **refuse to join them when they are plainly not**.
 *
 * It is the same greedy nearest-first linking as `findCrossings/tracks.ts`, which follows blobs
 * for half a second inside a line's window. Three things differ, and each is here for a reason
 * that cost something to learn:
 *
 * 1. **These live for laps, not half a second.** A car goes behind the drivers' stand, a board, a
 *    marshal; the gap it may survive is half a second rather than a tenth.
 *
 * 2. **A tracklet remembers how big it is.** A blob well under half or well over twice the size
 *    the thing has been is not the thing. Cars keep their size from frame to frame; a person's
 *    legs, two cars becoming one blob, and a patch of grain do not. Without this the linker
 *    happily walks off a 40 px car onto a 6 px flicker and back, which is how a path ends up
 *    somewhere the car never was.
 *
 * 3. **A merge is a doubt, and the timing sheet settles it.** When two open tracklets have to
 *    share one blob, the moment is written down on the path and the path carries on.
 *
 *    It used to end both paths there, on the reasoning that nothing may carry identity through a
 *    moment when there is nothing to carry it with. That is sound, and on real footage it was
 *    ruinous: in a six-car race cars run within a couple of lengths of each other for whole
 *    corners, and measured on the Boronia race (2026-09-08) **1 387 of 1 506 paths ended in a
 *    merge**, median life six tenths of a second. A path that short never reaches a start line, so
 *    it is never named, so it contributes nothing — lap coverage came out at **4 %** and not one
 *    of 67 named laps had a path worth drawing.
 *
 *    The cure is to remember whose job identity is. It is not the linker's. `name.ts` checks every
 *    path against the sheet at every start-line crossing, and a path that has genuinely swapped
 *    cars fits one driver before the swap and another after — which is caught there, and cut
 *    there, with a fact rather than a suspicion. Cutting on suspicion throws away the very
 *    evidence that would have settled it.
 *
 * Positions are full-frame pixels throughout, as `coarse.ts` hands them over, so the drawn lines
 * and everything downstream speak one coordinate system.
 *
 * Pure: observations in, tracklets out.
 */

import type { Obs, ObsFrame } from "../trace/chain";

/** How a tracklet began and how it finished — the linker's own account of what it could not see. */
export type TrackletEdge = "new" | "merge" | "lost" | "end";

export type Tracklet = {
  id: number;
  /** Time order, one per frame the thing was seen in. */
  points: Obs[];
  /** Median of the longest side of its blobs, full-frame pixels. */
  sizePx: number;
  /** Frames inside its life where it was not seen. */
  gaps: number;
  startedBy: TrackletEdge;
  endedBy: TrackletEdge;
  /**
   * Moments this path had to share a blob with another — where it MIGHT have changed cars.
   *
   * Not a verdict. The naming step reads these when a path turns out to fit two drivers, so the
   * cut lands where the doubt actually was rather than at an arbitrary crossing.
   */
  doubts: number[];
};

export type LinkParams = {
  /** A tracklet with no blob for this long is closed off. */
  maxGapSec: number;
  /** How far a thing with no heading yet may travel in a second, in its own lengths. */
  reachCarLengths: number;
  /**
   * How far a thing WITH a heading may end up from where that heading said, per second, in its
   * own lengths — what it has left to spend on turning, braking and accelerating.
   *
   * This is the gate that matters, and it has to be the prediction rather than the last sighting.
   * Gating on the last sighting alone lets the reach grow with the gap, so a tracklet that has
   * been out of sight for a third of a second may claim anything within several hundred pixels —
   * and a car leaving shot at one side was measured joining to a different car entering at the
   * other, 500 px away, because the arithmetic said it could have got there. It could have; it
   * plainly did not, because it was not going that way. A car that genuinely turns out of its own
   * prediction over a long gap becomes two tracklets instead, which is the honest answer:
   * `name.ts` re-establishes who it is at the next start-line crossing.
   */
  driftCarLengths: number;
  /**
   * The most that tolerance may ever be, in car lengths, however long the gap.
   *
   * Without a ceiling the allowance still grows with the gap, just more slowly, and a tracklet
   * that went quiet half a second ago ends up able to reach most of the frame — which in testing
   * had a car leaving shot on one side sharing a blob with a different car entering on the other,
   * five hundred pixels away, and the merge rule then cut both of them for nothing.
   *
   * Ten lengths is deliberately tight. A car that brakes to a stop behind a board genuinely can
   * end up further from its heading than this, and it will be cut — but that lap has a hole in it
   * whatever happens, and the two mistakes are not equal: a missed join is a gap the naming step
   * repairs at the next start line, while a wrong join is one driver's lap silently becoming
   * another's. Gaps over guesses, as everywhere else here.
   */
  maxDriftCarLengths: number;
  /** The car's apparent length until a tracklet has measured its own, full-frame pixels. */
  carPx: number;
  /** A blob smaller than this share of the tracklet's own size is not it. */
  sizeLo: number;
  /** …nor is one bigger than this multiple. */
  sizeHi: number;
  /**
   * How close two tracklets must be before losing a blob to one another counts as a merge, in car
   * lengths.
   *
   * Two things have merged when they are one blob, which means they are on top of each other. A
   * tracklet that simply was not seen this frame — the car behind a marshal's leg for a moment —
   * also ends up with no blob, and something else may well have taken a blob that was inside its
   * generous tolerance; cutting both for that is wrong, and measured on the synthetic field it cut
   * 193 times in 26 seconds and left the paths in 222 unusable fragments. Requiring the two to be
   * within a couple of car lengths of each other separates "these are the same object now" from
   * "these merely could have been".
   */
  mergeCarLengths: number;
  /**
   * Frames a contest has to persist before it is called a merge.
   *
   * One frame of a blob going missing beside a rival is the commonest thing in a race and is not
   * two cars becoming one. Three frames of it, with neither able to claim its own blob, is.
   */
  mergeFrames: number;
  /**
   * …unless the contested blob is already this many times the size of one car, in which case it
   * plainly holds two and there is nothing to wait for.
   */
  mergeSizeRatio: number;
  /** Fewest sightings before a tracklet is worth passing on. */
  minPoints: number;
  /** A tracklet that never left a circle this many car lengths across is furniture. */
  standingRadiusCarLengths: number;
  /** …but only once it has been around this long, so a brief blob is short, not furniture. */
  standingSec: number;
};

/**
 * Defaults, expressed against the car's own size so they hold at any resolution.
 *
 * `reachCarLengths` is deliberately generous — 45 lengths a second is about 16 m/s for a tenth-
 * scale car, well past anything on a club track. A gate tight enough to reject noise on its own
 * would break a real car on the straight, and the size memory and the merge rule do the rejecting
 * far more reliably than a distance cap can. The same reasoning, and the same number, as
 * `defaultTrackerConfig`.
 */
export function defaultLinkParams(carPx: number): LinkParams {
  return {
    maxGapSec: 0.5,
    reachCarLengths: 45,
    driftCarLengths: 25,
    maxDriftCarLengths: 10,
    carPx,
    sizeLo: 0.4,
    sizeHi: 2.5,
    mergeCarLengths: 2.5,
    mergeFrames: 3,
    mergeSizeRatio: 1.4,
    minPoints: 3,
    standingRadiusCarLengths: 0.6,
    standingSec: 2,
  };
}

type Open = {
  id: number;
  points: Obs[];
  lastT: number;
  vx: number;
  vy: number;
  /** Longest sides seen, for the running median. */
  sizes: number[];
  startedBy: TrackletEdge;
  frames: number;
  /** Consecutive frames this tracklet has lost a blob to a rival sitting on top of it. */
  contested: number;
  doubts: number[];
};

/** Seconds of sightings the heading is read over — one step of blob jitter is no heading at all. */
const HEADING_SEC = 0.3;

function longestSide(o: Obs): number {
  return Math.max(o.w, o.h);
}

function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/** Heading from the oldest sighting within reach against the newest. */
function heading(points: Obs[]): { vx: number; vy: number } {
  const n = points.length;
  if (n < 2) return { vx: 0, vy: 0 };
  const b = points[n - 1]!;
  let i = n - 2;
  while (i > 0 && b.t - points[i - 1]!.t <= HEADING_SEC) i--;
  const a = points[i]!;
  const span = b.t - a.t;
  if (span <= 0) return { vx: 0, vy: 0 };
  return { vx: (b.x - a.x) / span, vy: (b.y - a.y) / span };
}

/**
 * Sightings the size memory looks back over.
 *
 * **Not the whole tracklet.** A car crossing a wide-angle view changes size by a factor of four
 * between the near end of the track and the far one, steadily, over a couple of seconds. Judged
 * against its whole life's median, a car that has receded to a third of the size it started at
 * fails its own size test and is dropped — and then found again as a new tracklet, and dropped
 * again. Measured on the Boronia race (2026-09-08) that produced **1 534 paths averaging under a
 * second each** for six cars over four minutes, none of them long enough to reach a corner: every
 * sector crossing came back missing while the start line, which the cars pass at a constant size,
 * was found on 62 laps of 64.
 *
 * A handful of recent sightings tracks the perspective change and still refuses a blob five times
 * the size of the thing it has been following for the last quarter second.
 */
const SIZE_MEMORY = 7;

function sizeOf(open: Open, fallback: number): number {
  if (!open.sizes.length) return fallback;
  return medianOf(open.sizes.slice(-SIZE_MEMORY));
}

function finish(open: Open, endedBy: TrackletEdge, p: LinkParams): Tracklet {
  return {
    id: open.id,
    points: open.points,
    sizePx: sizeOf(open, p.carPx),
    gaps: Math.max(0, open.frames - open.points.length),
    startedBy: open.startedBy,
    endedBy,
    doubts: open.doubts,
  };
}

/**
 * How far a tracklet's sightings stray from the middle of them — the furniture test.
 *
 * A car crosses a sector, so its sightings are spread along the road. A marshal at a corner, a
 * parked car on the grass, a driver's stand that flickers: all of them differ from the still
 * picture of the empty track in every frame, in the same place, and are car-sized, so they
 * survive every filter aimed at grain. Standing still is the thing no racing car does.
 */
export function spreadOf(points: Obs[]): number {
  if (points.length < 2) return 0;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let worst = 0;
  for (const p of points) worst = Math.max(worst, Math.hypot(p.x - cx, p.y - cy));
  return worst;
}

export type LinkResult = {
  tracklets: Tracklet[];
  /** Dropped for standing still — counted so the review can say what the footage was full of. */
  standing: number;
  /** Dropped for being too short to mean anything. */
  tooShort: number;
  /** Times two or more tracklets ran into one blob and were all cut. */
  merges: number;
};

/**
 * Link every frame's moving things into tracklets.
 *
 * Frames must be in time order. Anything that stood still, or was seen too few times to say
 * anything about, is left out of the result and counted instead.
 */
export function linkTracklets(frames: ObsFrame[], p: LinkParams): LinkResult {
  const open: Open[] = [];
  const done: Tracklet[] = [];
  let nextId = 1;
  let merges = 0;

  for (const frame of frames) {
    // Anything that has gone quiet for too long is closed, so it cannot claim a blob much later.
    for (let i = open.length - 1; i >= 0; i--) {
      if (frame.t - open[i]!.lastT > p.maxGapSec) done.push(finish(open.splice(i, 1)[0]!, "lost", p));
    }
    for (const o of open) o.frames++;

    // Every pairing that is possible at all: within reach of where the thing was heading, and
    // the right size for what it has been.
    const pairs: Array<{ t: number; b: number; d: number }> = [];
    const canTake: number[][] = frame.blobs.map(() => []);
    for (let ti = 0; ti < open.length; ti++) {
      const tr = open[ti]!;
      const dt = frame.t - tr.lastT;
      if (dt <= 0) continue;
      const last = tr.points[tr.points.length - 1]!;
      const size = sizeOf(tr, p.carPx);
      // Where it was heading, and how far off that it may be. A tracklet with no heading yet has
      // no prediction to be off, so it is judged on plain reach from where it was.
      const known = tr.points.length >= 2 && (tr.vx !== 0 || tr.vy !== 0);
      const px = last.x + tr.vx * dt;
      const py = last.y + tr.vy * dt;
      const tol = known
        ? Math.min(p.driftCarLengths * size * dt + size, p.maxDriftCarLengths * size)
        : Math.min(p.reachCarLengths * size * dt, p.maxDriftCarLengths * size);
      for (let bi = 0; bi < frame.blobs.length; bi++) {
        const blob = frame.blobs[bi]!;
        const d = Math.hypot(blob.x - px, blob.y - py);
        if (d > tol) continue;
        const s = longestSide(blob);
        if (s < size * p.sizeLo || s > size * p.sizeHi) continue;
        pairs.push({ t: ti, b: bi, d });
        canTake[bi]!.push(ti);
      }
    }

    // Who would take what, nearest to its own prediction first. Tentative: a pairing only stands
    // once it is clear nothing else was fighting for the same blob.
    pairs.sort((a, b) => a.d - b.d);
    const gotBlob = new Map<number, number>();
    const takenBy = new Map<number, number>();
    for (const pair of pairs) {
      if (gotBlob.has(pair.t) || takenBy.has(pair.b)) continue;
      gotBlob.set(pair.t, pair.b);
      takenBy.set(pair.b, pair.t);
    }

    // A merge is a cut. A tracklet that wanted a blob and lost it to another tracklet sitting
    // right on top of it did not miss its car — the two cars became one blob, and there is
    // nothing left to tell them apart with. Both end here; the blob they were fighting over
    // begins a tracklet of its own, with no history at all.
    // Moments where two paths had to share one blob. Recorded, never acted on here.
    for (let ti = 0; ti < open.length; ti++) {
      const tr = open[ti]!;
      if (gotBlob.has(ti)) {
        tr.contested = 0;
        continue;
      }
      const wanted = canTake.findIndex((list) => list.includes(ti));
      if (wanted < 0) {
        tr.contested = 0;
        continue;
      }
      const rival = takenBy.get(wanted);
      if (rival == null) {
        tr.contested = 0;
        continue;
      }
      const mine = tr.points[tr.points.length - 1]!;
      const theirs = open[rival]!.points[open[rival]!.points.length - 1]!;
      const apart = Math.hypot(mine.x - theirs.x, mine.y - theirs.y);
      const size = Math.max(sizeOf(tr, p.carPx), sizeOf(open[rival]!, p.carPx));
      // Far apart, and this is not a merge at all: one of them merely went unseen this frame,
      // and its car is somewhere else entirely.
      if (apart > size * p.mergeCarLengths) {
        tr.contested = 0;
        continue;
      }
      // Two things are one blob, or one of them simply was not seen this frame. Telling those
      // apart needs more than a single frame: in a six-car race, cars run within a couple of
      // lengths of each other for whole corners, and a blob that flickers out for one frame there
      // would otherwise cut BOTH paths — measured 2026-09-08, 1 379 merges over 7 776 frames,
      // which left almost every lap without a path of its own. So a merge has to persist, and it
      // helps if the blob is visibly too big for one car.
      tr.contested++;
      const bigEnough = longestSide(frame.blobs[wanted]!) >= sizeOf(open[rival]!, p.carPx) * p.mergeSizeRatio;
      if (tr.contested < p.mergeFrames && !bigEnough) continue;
      merges++;
      // Written down on both paths, and both carry on. The sheet decides afterwards whether
      // anything actually changed hands here.
      tr.doubts.push(frame.t);
      open[rival]!.doubts.push(frame.t);
      tr.contested = 0;
    }

    const usedBlob = new Set<number>();
    for (const [ti, bi] of gotBlob) {
      usedBlob.add(bi);
      const tr = open[ti]!;
      const blob = frame.blobs[bi]!;
      tr.points.push(blob);
      tr.sizes.push(longestSide(blob));
      tr.lastT = frame.t;
      const h = heading(tr.points);
      tr.vx = h.vx;
      tr.vy = h.vy;
    }

    // Anything unclaimed starts its own tracklet — a car coming into shot has to begin somewhere,
    // and so does whatever two cars turned into when they touched.
    for (let bi = 0; bi < frame.blobs.length; bi++) {
      if (usedBlob.has(bi)) continue;
      const blob = frame.blobs[bi]!;
      open.push({
        id: nextId++,
        points: [blob],
        lastT: frame.t,
        vx: 0,
        vy: 0,
        sizes: [longestSide(blob)],
        startedBy: "new",
        frames: 1,
        contested: 0,
        doubts: [],
      });
    }

  }

  for (const o of open) done.push(finish(o, "end", p));

  const tracklets: Tracklet[] = [];
  let standing = 0;
  let tooShort = 0;
  for (const t of done) {
    if (t.points.length < p.minPoints) {
      tooShort++;
      continue;
    }
    const lived = t.points[t.points.length - 1]!.t - t.points[0]!.t;
    if (lived >= p.standingSec && spreadOf(t.points) < t.sizePx * p.standingRadiusCarLengths) {
      standing++;
      continue;
    }
    tracklets.push(t);
  }
  tracklets.sort((a, b) => a.points[0]!.t - b.points[0]!.t);
  return { tracklets, standing, tooShort, merges };
}
