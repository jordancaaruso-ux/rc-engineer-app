/**
 * Which blobs were the car, decided for a whole stretch at once and pinned at both ends.
 *
 * Following a car frame by frame and taking the nearest blob each time is how a tracker ends up
 * on the rival: one bad frame and it never comes back. Here every moving thing the window saw is
 * kept, and the path is chosen afterwards as the cheapest chain of blobs that starts where the
 * car crossed one sector line and ends where it crossed the next, both of which the crossing scan
 * already knows to the frame. A chain that wanders onto another car has to jump back before the
 * line, and the jump is what it pays for.
 *
 * The cost of stepping from one blob to the next is how far the second sits from where the
 * first was heading (constant velocity, in car lengths), plus a charge for every frame skipped.
 * Skipping is allowed anywhere, so a car hidden behind a board comes back when it reappears; a
 * skip longer than `maxGapSec` is a hole in the path, drawn as a break. Where a second chain
 * through a different car costs about the same, the stretch is a hole too ("ambiguous"), because
 * a guess drawn as a line is a lie.
 *
 * Pure: blobs in, a chain out. No pixels here.
 */

import {
  chromaDistance,
  chromaOf,
  colourUsable,
  toleranceFor,
  type CarColour,
  type Rgb,
} from "../findCrossings/carColour";
import type { TraceHoleWhy } from "@/lib/manualVideoAnalysis/types";

/** One moving thing in one frame, in full-frame pixels. */
export type Obs = {
  t: number;
  x: number;
  y: number;
  /** Bounding box of the blob, pixels. */
  w: number;
  h: number;
  area: number;
  colour?: Rgb;
};

/** Everything that moved in one frame the window read. */
export type ObsFrame = { t: number; blobs: Obs[] };

/** A crossing the chain must pass through: when, and where if known. */
export type ChainAnchor = { t: number; x: number | null; y: number | null };

export type ChainPoint = Obs & { frame: number; blob: number };

export type ChainHole = { fromT: number; toT: number; why: TraceHoleWhy };

export type ChainParams = {
  /** The car's apparent length, pixels: the unit every distance is measured in. */
  carPx: number;
  /**
   * Charge per frame with no blob taken.
   *
   * Skipping and stepping are priced against each other, so this decides how far off its
   * prediction a blob may sit before the chain would rather draw nothing: at two a frame,
   * anything past about one and a half tolerances is dropped.
   *
   * Charging MORE to pass over a frame that did hold something moving was tried on 2026-09-07,
   * on the reasoning that a frame with something in it is not the same claim as a blind one. It
   * bought a real gain while the tracer was still losing the car — and once the tracer learnt the
   * track from laps already followed (`road.ts`) it became a loss on every count: the drawn line
   * fell six points, the readings the sector board disagreed with doubled, and the mean error of
   * the rest went up by four milliseconds. It was patching a hole that had been filled.
   */
  missPerFrame: number;
  /** A step longer than this is a hole, and pays `holePenalty` instead of a prediction error. */
  maxGapSec: number;
  holePenalty: number;
  /**
   * Ceiling on one step's prediction error. A chain that leaves the car for another and comes
   * back pays this twice; it has to cost more than the honest alternative, a hole of misses, or
   * a stretch where the car cannot be seen is drawn as whatever else was moving. With misses at
   * two a frame and this at sixty, another car wins only over a gap longer than two seconds,
   * which is longer than any sector here (Bendigo L5, 2026-09-06: at twenty it took a car on
   * the near straight for one at the far end).
   */
  jumpCap: number;
  /**
   * A second chain within this much of the best makes the stretch ambiguous. Wide enough to cover
   * two cars driving differently (one changing its line pays for the acceleration, a few units
   * over a second) and well under what a chain pays to jump onto a pinned crossing from another
   * car (the jump cap, sixty).
   *
   * It used to be widened by a tenth of the best chain's own cost, which is backwards: the harder
   * the stretch, the higher that cost, so the net was cast widest exactly where there were most
   * candidates to catch. On the far sector of the Bendigo fisheye it made every rival within 14 %
   * of the best count as an equal, and the tracer refused to draw stretches it had followed
   * perfectly well — 160 frames of one grading set given up (2026-09-07). Dropping the term left
   * 39, took eleven holes off the same fifteen laps, and changed no reading against the sector
   * board. The absolute figure itself is not sensitive: 1.0 and 3.0 grade identically, so the
   * conservative one stays.
   */
  ambiguousMargin: number;
  /** Two candidate blobs closer than this many car lengths are the same car, not an ambiguity. */
  ambiguousSeparation: number;
  /**
   * A blob in this share of the stretch's frames, always in the same place, is furniture rather
   * than a car, and is dropped before the chain sees it. One at or above the share is never a
   * candidate; below it, nothing is dropped.
   *
   * A still picture of the empty track is the middle of five frames spread over the lap, so
   * anything that did not move over those frames is part of it and vanishes. Anything that DID
   * move in some of them but stands still now — a car parked on the grass, a marshal, a driver's
   * stand — differs from the picture in every frame, at the same place, and is car-sized. It
   * therefore survives every filter aimed at grain and crowds out the real car in the frame's
   * shortlist. Standing still for a whole sector is the thing no racing car does.
   */
  staticShare: number;
  /** How close two sightings must be to be the same standing thing, in car lengths. */
  staticRadius: number;
  /** The driver's paint, when it is known well enough to say "not this one". */
  car?: CarColour | null;
  /** Told, per frame, what was chosen and how close every other blob's best chain came. */
  debug?: (f: ChainDebugFrame) => void;
};

export type ChainDebugFrame = {
  frame: number;
  t: number;
  chosen: { x: number; y: number; fwd: number; bwd: number } | null;
  others: Array<{ x: number; y: number; fwd: number; bwd: number; throughMinusBest: number; apartCarLengths: number }>;
};

export function defaultChainParams(carPx: number): ChainParams {
  return {
    carPx,
    missPerFrame: 2,
    maxGapSec: 0.5,
    holePenalty: 4,
    jumpCap: 60,
    ambiguousMargin: 3.0,
    ambiguousSeparation: 2,
    staticShare: 0.5,
    staticRadius: 0.6,
  };
}

export type ChainResult = {
  points: ChainPoint[];
  holes: ChainHole[];
  ambiguousFrames: number;
  /** Total cost of the chosen chain. */
  cost: number;
  /** Frames read in this stretch. */
  frames: number;
};

type Node = {
  t: number;
  x: number | null;
  y: number | null;
  /** Frame index; -1 for the start anchor, `frames.length` for the end anchor. */
  frame: number;
  blob: number;
  area: number;
  colour?: Rgb;
};

/** Ambiguous runs shorter than this are jitter, not a second car. */
const AMBIGUOUS_MIN_FRAMES = 2;
/**
 * How far back a step may reach, in seconds. Beyond it a node is reached through a hole from the
 * best chain that had ended by then, at the miss charge per frame plus the hole penalty — so the
 * work is linear in the frames rather than quadratic, and a car lost for longer than this still
 * comes back onto the same chain. A lost window on real footage hands the chain thousands of
 * blobs, and the unbounded version ran for ten minutes on one lap (Bendigo, 2026-09-06).
 */
const LOOKBACK_SEC = 2.0;

/**
 * Prediction tolerance for a step of `dt` seconds, in pixels. Tight when the previous step gave
 * a velocity (a car cannot change course much in a frame), loose without one, and looser the
 * longer the step: after half a second the car could be a few lengths from anywhere.
 */
function tolerance(carPx: number, dt: number, hasVelocity: boolean): number {
  return carPx * ((hasVelocity ? 0.5 : 1.0) + 6 * dt);
}

function colourCostOf(colour: Rgb | undefined, car: CarColour | null | undefined): number {
  if (!colour || !colourUsable(car)) return 0;
  const d = chromaDistance(chromaOf(colour), car.chroma);
  const tol = toleranceFor(car);
  // Weak on purpose: the same car reads as far from its start-line reference at a far corner
  // as a rival does beside it (measured 2026-08-28). Colour nudges; the geometry decides.
  return d > 2 * tol ? 0.6 : d > tol ? 0.2 : 0;
}

/** The cost of stepping from node i to node j, given how i was reached. */
function edgeCost(nodes: Node[], prev: Int32Array, i: number, j: number, p: ChainParams): number {
  const ni = nodes[i]!;
  const nj = nodes[j]!;
  let c = p.missPerFrame * Math.max(0, nj.frame - ni.frame - 1);
  if (ni.x == null || ni.y == null || nj.x == null || nj.y == null) return c;
  const dt = nj.t - ni.t;
  if (dt > p.maxGapSec) return c + p.holePenalty;
  // Velocity from how i was reached: over the last two steps when both are close, because one
  // step of a jittering centroid is too noisy a heading to hold the next blob to.
  let vx = 0;
  let vy = 0;
  let hasV = false;
  const pi = prev[i]!;
  if (pi >= 0) {
    const np = nodes[pi]!;
    if (np.x != null && np.y != null && ni.t - np.t > 0 && ni.t - np.t <= p.maxGapSec) {
      let from = np;
      const ppi = prev[pi]!;
      if (ppi >= 0) {
        const npp = nodes[ppi]!;
        if (npp.x != null && npp.y != null && np.t - npp.t > 0 && np.t - npp.t <= p.maxGapSec) from = npp;
      }
      const ddt = ni.t - from.t;
      vx = (ni.x - from.x!) / ddt;
      vy = (ni.y - from.y!) / ddt;
      hasV = true;
    }
  }
  const e = Math.hypot(nj.x - (ni.x + vx * dt), nj.y - (ni.y + vy * dt));
  const tau = tolerance(p.carPx, dt, hasV);
  c += Math.min(p.jumpCap, (e / tau) ** 2);
  if (ni.area > 0 && nj.area > 0) {
    const r = Math.log(nj.area / ni.area);
    c += Math.min(1, 0.15 * r * r);
  }
  return c;
}

/** Cheapest way to every node from node 0, in the order given (time order, frames ascending). */
function runDp(
  nodes: Node[],
  nodeCost: Float64Array,
  p: ChainParams
): { cost: Float64Array; prev: Int32Array } {
  const n = nodes.length;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  // The cheapest chain that has ended at or before each node's frame, carried forward at the
  // miss charge: what a step from beyond the lookback costs, whoever it comes from.
  const runBest = new Float64Array(n).fill(Infinity);
  const runBestNode = new Int32Array(n).fill(-1);
  cost[0] = 0;
  runBest[0] = 0;
  runBestNode[0] = 0;
  let lo = 0;
  let hole = 0;
  for (let j = 1; j < n; j++) {
    const nj = nodes[j]!;
    while (lo < j && nj.t - nodes[lo]!.t > LOOKBACK_SEC) lo++;
    let best = Infinity;
    let bestI = -1;
    for (let i = lo; i < j; i++) {
      if (cost[i] === Infinity) continue;
      if (nodes[i]!.t >= nj.t) continue;
      const c = cost[i]! + edgeCost(nodes, prev, i, j, p);
      if (c < best) {
        best = c;
        bestI = i;
      }
    }
    // The last node whose frame lies before the lookback: a hole from the best chain so far.
    while (hole + 1 < lo && nodes[hole + 1]!.frame < nodes[lo]!.frame) hole++;
    if (hole < lo && runBest[hole] !== Infinity && nodes[hole]!.frame < nj.frame - 1) {
      const k = runBestNode[hole]!;
      const c = runBest[hole]! + p.missPerFrame * (nj.frame - 1 - nodes[hole]!.frame) + p.holePenalty;
      if (c < best) {
        best = c;
        bestI = k;
      }
    }
    cost[j] = best + nodeCost[j]!;
    prev[j] = bestI;
    // Carry the running best forward to this node's frame.
    const carried = runBest[j - 1]! + p.missPerFrame * (nj.frame - nodes[j - 1]!.frame);
    if (cost[j]! <= carried) {
      runBest[j] = cost[j]!;
      runBestNode[j] = j;
    } else {
      runBest[j] = carried;
      runBestNode[j] = runBestNode[j - 1]!;
    }
  }
  return { cost, prev };
}

/**
 * The frames again with anything that stood still for the stretch taken out of them.
 *
 * "Still" is measured against the sighting itself: how many of the stretch's frames hold a blob
 * within a fraction of a car length of it. A car crosses a sector, so its own sightings are
 * spread along the road and only a handful land on any one of them; a marshal standing at a
 * corner lands on all of them.
 */
export function withoutStanding(frames: ObsFrame[], p: ChainParams): ObsFrame[] {
  const n = frames.length;
  if (n < 4) return frames;
  const limit = p.staticShare * n;
  const r = p.staticRadius * p.carPx;
  const r2 = r * r;
  const flat: Array<{ f: number; x: number; y: number }> = [];
  for (const [f, frame] of frames.entries()) {
    for (const b of frame.blobs) flat.push({ f, x: b.x, y: b.y });
  }
  const standing = new Set<string>();
  for (const [f, frame] of frames.entries()) {
    for (const [i, b] of frame.blobs.entries()) {
      const seen = new Set<number>();
      for (const o of flat) {
        if (o.f === f) continue;
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        if (dx * dx + dy * dy <= r2) seen.add(o.f);
      }
      if (seen.size >= limit) standing.add(`${f}:${i}`);
    }
  }
  if (!standing.size) return frames;
  return frames.map((frame, f) => ({
    t: frame.t,
    blobs: frame.blobs.filter((_, i) => !standing.has(`${f}:${i}`)),
  }));
}

/**
 * The chain from `start` to `end` through the blobs of `frames` (time order, `start.t` before
 * the first frame, `end.t` after the last). Either anchor may lack a position, and then the chain
 * only has to cover the frames; a null anchor is the same thing.
 */
export function chainThrough(
  rawFrames: ObsFrame[],
  start: ChainAnchor | null,
  end: ChainAnchor | null,
  p: ChainParams
): ChainResult {
  const frames = p.staticShare < 1 ? withoutStanding(rawFrames, p) : rawFrames;
  const firstT = frames.length ? frames[0]!.t : (start?.t ?? 0);
  const lastT = frames.length ? frames[frames.length - 1]!.t : (end?.t ?? firstT);
  const nodes: Node[] = [
    {
      t: start ? Math.min(start.t, firstT - 1e-6) : firstT - 1e-6,
      x: start?.x ?? null,
      y: start?.y ?? null,
      frame: -1,
      blob: -1,
      area: 0,
    },
  ];
  for (const [f, frame] of frames.entries()) {
    for (const [b, blob] of frame.blobs.entries()) {
      nodes.push({
        t: frame.t,
        x: blob.x,
        y: blob.y,
        frame: f,
        blob: b,
        area: blob.area,
        colour: blob.colour,
      });
    }
  }
  nodes.push({
    t: end ? Math.max(end.t, lastT + 1e-6) : lastT + 1e-6,
    x: end?.x ?? null,
    y: end?.y ?? null,
    frame: frames.length,
    blob: -1,
    area: 0,
  });
  const n = nodes.length;
  const nodeCost = new Float64Array(n);
  for (let i = 0; i < n; i++) nodeCost[i] = colourCostOf(nodes[i]!.colour, p.car);

  const fwd = runDp(nodes, nodeCost, p);
  // The same chain read backwards, for the second opinion: how good is the best path THROUGH
  // any given blob. Time and frame indices are negated so "earlier" means the same thing.
  const rev: Node[] = [...nodes]
    .reverse()
    .map((nd) => ({ ...nd, t: -nd.t, frame: frames.length - 1 - nd.frame }));
  const revCost = new Float64Array(n);
  for (let i = 0; i < n; i++) revCost[i] = nodeCost[n - 1 - i]!;
  const bwd = runDp(rev, revCost, p);
  const through = (i: number) => fwd.cost[i]! + bwd.cost[n - 1 - i]! - nodeCost[i]!;
  const best = fwd.cost[n - 1]!;

  // Walk the chosen chain back from the end anchor.
  const chosen = new Int32Array(frames.length).fill(-1);
  for (let i = fwd.prev[n - 1]!; i > 0; i = fwd.prev[i]!) chosen[nodes[i]!.frame] = i;

  // Ambiguity: another blob in the same frame, well away from the chosen one, that a chain
  // about as cheap as the best runs through.
  const margin = p.ambiguousMargin;
  const ambiguous = new Uint8Array(frames.length);
  const dbg: ChainDebugFrame[] | null = p.debug
    ? frames.map((f, k) => ({ frame: k, t: f.t, chosen: null, others: [] }))
    : null;
  for (let i = 1; i < n - 1; i++) {
    const nd = nodes[i]!;
    const c = chosen[nd.frame]!;
    if (dbg && c === i) dbg[nd.frame]!.chosen = { x: nd.x!, y: nd.y!, fwd: fwd.cost[i]!, bwd: bwd.cost[n - 1 - i]! };
    if (c < 0 || c === i) continue;
    const cn = nodes[c]!;
    const apart = Math.hypot(nd.x! - cn.x!, nd.y! - cn.y!) / p.carPx;
    const gap = through(i) - best;
    if (dbg) {
      dbg[nd.frame]!.others.push({
        x: nd.x!,
        y: nd.y!,
        fwd: fwd.cost[i]!,
        bwd: bwd.cost[n - 1 - i]!,
        throughMinusBest: gap,
        apartCarLengths: apart,
      });
    }
    if (apart <= p.ambiguousSeparation) continue;
    if (gap <= margin) ambiguous[nd.frame] = 1;
  }
  if (dbg && p.debug) for (const f of dbg) p.debug(f);
  // Only runs long enough to be a car count; a single frame is jitter.
  let ambiguousFrames = 0;
  for (let f = 0; f < frames.length; ) {
    if (!ambiguous[f]) {
      f++;
      continue;
    }
    let g = f;
    while (g < frames.length && ambiguous[g]) g++;
    if (g - f < AMBIGUOUS_MIN_FRAMES) {
      for (let k = f; k < g; k++) ambiguous[k] = 0;
    } else {
      ambiguousFrames += g - f;
    }
    f = g;
  }

  const points: ChainPoint[] = [];
  const holes: ChainHole[] = [];
  let lastKeptT: number | null = start?.t ?? null;
  let pendingAmbiguous = false;
  for (let f = 0; f < frames.length; f++) {
    const c = chosen[f]!;
    if (c < 0) continue;
    if (ambiguous[f]) {
      pendingAmbiguous = true;
      continue;
    }
    const nd = nodes[c]!;
    const blob = frames[f]!.blobs[nd.blob]!;
    const t = frames[f]!.t;
    if (lastKeptT != null && (pendingAmbiguous || t - lastKeptT > p.maxGapSec)) {
      holes.push({ fromT: lastKeptT, toT: t, why: pendingAmbiguous ? "ambiguous" : "lost" });
    }
    pendingAmbiguous = false;
    points.push({ ...blob, frame: f, blob: nd.blob });
    lastKeptT = t;
  }
  // A stretch left doubtful at the very end of the segment is a hole to the end anchor, or to
  // the last frame read when there is no anchor to reach.
  const tailT = end?.t ?? lastT;
  if (lastKeptT != null && (pendingAmbiguous || (end != null && tailT - lastKeptT > p.maxGapSec))) {
    holes.push({ fromT: lastKeptT, toT: tailT, why: pendingAmbiguous ? "ambiguous" : "lost" });
  }

  return { points, holes, ambiguousFrames, cost: best, frames: frames.length };
}
