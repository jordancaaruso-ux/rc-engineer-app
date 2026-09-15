/**
 * A whole race we know the truth about, rendered as pixels.
 *
 * `trace/synthetic.ts` builds one car on one path for the tracer. The race pass needs more than
 * that, because the things it has to get right are all about *several* moving objects and the
 * timing sheet that tells them apart: a field on the same loop at different lap times, a person
 * who never leaves the same spot, a marshal who walks across a line once, deep shade where a car
 * goes invisible, and two cars that touch.
 *
 * The point of rendering pixels rather than handing the linker made-up blobs is that the whole
 * chain gets exercised — the still picture, the two-ways rule, the blob floor, the linker's size
 * memory — on a scene whose every crossing time is known exactly. Nothing here looks like a race
 * track, and it is not meant to: real footage tests glare and kerbs, this tests the arithmetic.
 *
 * The loop is an ellipse and the lines are short segments across it, placed so that each is
 * crossed once a lap — except where a test wants one crossed twice, which is what a hairpin does
 * and what the track-order rule has to survive.
 */

import type { SectorLine } from "../findCrossings/types";

export const SCENE_W = 320;
export const SCENE_H = 200;
export const SCENE_FPS = 30;
/** The car's side in scene pixels. */
export const SCENE_CAR = 12;

const CX = 160;
const CY = 100;
const RX = 120;
const RY = 70;

/**
 * Where a car is, a fraction of the way round.
 *
 * Phase 0.75 is the top of the loop, which is where the start line is, so a lap runs 0.75 → 1.75.
 * The quarters after it fall on the three corner lines in track order.
 */
export function atPhase(phase: number): { x: number; y: number } {
  const th = 2 * Math.PI * phase;
  return { x: CX + RX * Math.cos(th), y: CY + RY * Math.sin(th) };
}

/**
 * The lines, in the order they are met from the start line.
 *
 * Each is a short segment reaching only a little either side of the loop, so that "strict to the
 * drawn ends" is doing real work: the ellipse passes the *infinite* line through each of them
 * twice, and only one of those passes is inside the segment.
 */
export const SCENE_LINES: SectorLine[] = [
  { lineKey: "sf", label: "Start/finish", sortOrder: 0, x1: 160 / SCENE_W, y1: 2 / SCENE_H, x2: 160 / SCENE_W, y2: 62 / SCENE_H },
  { lineKey: "s1", label: "Turn 1", sortOrder: 1, x1: 248 / SCENE_W, y1: 100 / SCENE_H, x2: 314 / SCENE_W, y2: 100 / SCENE_H },
  { lineKey: "s2", label: "Turn 2", sortOrder: 2, x1: 160 / SCENE_W, y1: 138 / SCENE_H, x2: 160 / SCENE_W, y2: 198 / SCENE_H },
  { lineKey: "s3", label: "Turn 3", sortOrder: 3, x1: 6 / SCENE_W, y1: 100 / SCENE_H, x2: 72 / SCENE_W, y2: 100 / SCENE_H },
];

/**
 * A line long enough to be crossed on both sides of the loop — what a hairpin's line does.
 *
 * It stands in for `s1`, so its two crossings fall a quarter and three quarters of the way round:
 * both inside the lap, which is the case that has to be got right. A line across the *top* of the
 * loop would also be crossed twice, but one of those is the lap boundary itself, where there is no
 * previous point inside the lap to interpolate from — invisible for a reason that has nothing to
 * do with hairpins.
 */
export const SCENE_HAIRPIN: SectorLine = {
  lineKey: "s1",
  label: "Hairpin",
  sortOrder: 1,
  x1: 6 / SCENE_W,
  y1: 100 / SCENE_H,
  x2: 314 / SCENE_W,
  y2: 100 / SCENE_H,
};

export type SceneDriver = {
  key: string;
  name: string;
  /** Video times this car goes over the start line, one per lap boundary. */
  lapStarts: number[];
  /** Lap numbers, one shorter than `lapStarts`. */
  firstLapNumber: number;
  /** How far round the loop this car sits from the others, to keep them apart in space. */
  lateral?: number;
  /** Not drawn at all between these times — behind a board. */
  hiddenBetween?: Array<[number, number]>;
};

export type SceneExtras = {
  /** Somebody who never moves: `at` is where, `wobble` how much they shift about. */
  standing?: Array<{ x: number; y: number; size: number; wobble: number; from: number; to: number }>;
  /** Somebody who walks from one place to another once. */
  walking?: Array<{ from: { x: number; y: number }; to: { x: number; y: number }; size: number; fromSec: number; toSec: number }>;
  /** A rectangle in which everything is drawn far dimmer — deep shade. */
  shade?: { x0: number; y0: number; x1: number; y1: number };
  /** One frame where the whole picture shifts, as if the camera were knocked. */
  bumpAtSec?: number;
};

export type Scene = {
  drivers: SceneDriver[];
  extras: SceneExtras;
  fromSec: number;
  toSec: number;
};

/** Where a driver is at a given moment, or null when they are not on track or not drawn. */
export function driverAt(d: SceneDriver, t: number): { x: number; y: number } | null {
  const starts = d.lapStarts;
  if (t < starts[0]! || t > starts[starts.length - 1]!) return null;
  for (const [from, to] of d.hiddenBetween ?? []) if (t >= from && t <= to) return null;
  let i = 0;
  while (i < starts.length - 2 && starts[i + 1]! <= t) i++;
  const start = starts[i]!;
  const end = starts[i + 1]!;
  const u = (t - start) / (end - start);
  const p = atPhase(0.75 + u);
  const lat = d.lateral ?? 0;
  if (!lat) return p;
  // Pushed in or out of the loop by a fixed number of pixels, so two cars are the same distance
  // apart wherever they are. Scaling the offset by the radius instead squeezes the lanes together
  // at the ends of the ellipse — which put three cars 8 px apart at the start line, closer than
  // the car is wide, so they merged on every lap and the scene tested the merge rule rather than
  // the thing it was written for.
  const ox = (p.x - CX) / RX;
  const oy = (p.y - CY) / RY;
  const n = Math.hypot(ox, oy) || 1;
  return { x: p.x + (ox / n) * lat, y: p.y + (oy / n) * lat };
}

/** The exact moment a driver goes over one of the scene's lines on one lap. */
export function trueCrossing(d: SceneDriver, lapIndex: number, lineKey: string): number | null {
  const start = d.lapStarts[lapIndex];
  const end = d.lapStarts[lapIndex + 1];
  if (start == null || end == null) return null;
  const lap = end - start;
  switch (lineKey) {
    case "sf":
      return start;
    case "s1":
      return start + lap * 0.25;
    case "s2":
      return start + lap * 0.5;
    case "s3":
      return start + lap * 0.75;
    default:
      return null;
  }
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(
  data: Uint8Array,
  cx: number,
  cy: number,
  size: number,
  value: number,
  shade: SceneExtras["shade"]
): void {
  const half = size / 2;
  const dim =
    shade && cx >= shade.x0 && cx <= shade.x1 && cy >= shade.y0 && cy <= shade.y1
      ? // Inside the shade the car is barely brighter than the track it sits on — under the gate
        // even over the darkest blocks, which is what makes the start line the hardest place to
        // see a car at Bendigo.
        0.03
      : 1;
  for (let y = Math.round(cy - half); y < Math.round(cy + half); y++) {
    for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) {
      if (x < 0 || y < 0 || x >= SCENE_W || y >= SCENE_H) continue;
      const i = (y * SCENE_W + x) * 4;
      const base = data[i]!;
      const v = Math.min(255, Math.round(base + (value - base) * dim));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }
}

/** One frame of the scene as RGBA, the shape a canvas readback would hand over. */
export function renderFrame(scene: Scene, t: number, seed: number): { width: number; height: number; channels: number; data: Uint8Array } {
  const r = rng(seed);
  const data = new Uint8Array(SCENE_W * SCENE_H * 4);
  const bump = scene.extras.bumpAtSec != null && Math.abs(t - scene.extras.bumpAtSec) < 1 / (2 * SCENE_FPS);
  for (let y = 0; y < SCENE_H; y++) {
    for (let x = 0; x < SCENE_W; x++) {
      const i = (y * SCENE_W + x) * 4;
      // A fixed texture plus a little grain, so the still picture has something to be a picture
      // OF, and the two-ways rule has grain to reject. Shifted bodily on a bumped frame.
      const sx = bump ? x + 5 : x;
      const sy = bump ? y + 3 : y;
      // Blocks with real contrast between them, not a gentle gradient. A track surface has edges
      // — kerbs, joins, painted lines — and they are the whole reason a nudged camera lights up
      // the entire frame at once. A texture too smooth to notice being shifted would let the
      // camera test pass for the wrong reason.
      const block = (((sx >> 3) + (sy >> 3)) & 1) === 0 ? 44 : 112;
      const texture = block + ((sx * 7 + sy * 13) % 11);
      const v = Math.min(255, Math.max(0, texture + Math.floor(r() * 3)));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const shade = scene.extras.shade;
  for (const d of scene.drivers) {
    const at = driverAt(d, t);
    if (at) paint(data, at.x, at.y, SCENE_CAR, 235, shade);
  }
  for (const s of scene.extras.standing ?? []) {
    if (t < s.from || t > s.to) continue;
    // Never still to the pixel — a person shifts their weight, which is why "it never moved" is
    // the wrong test and "it never went anywhere" is the right one.
    paint(data, s.x + Math.sin(t * 3) * s.wobble, s.y + Math.cos(t * 2.3) * s.wobble, s.size, 210, shade);
  }
  for (const w of scene.extras.walking ?? []) {
    if (t < w.fromSec || t > w.toSec) continue;
    const u = (t - w.fromSec) / (w.toSec - w.fromSec);
    paint(data, w.from.x + (w.to.x - w.from.x) * u, w.from.y + (w.to.y - w.from.y) * u, w.size, 205, shade);
  }
  return { width: SCENE_W, height: SCENE_H, channels: 4, data };
}

/** Every frame of the scene, in time order. */
export function renderScene(scene: Scene): Array<{ t: number; frame: ReturnType<typeof renderFrame> }> {
  const out: Array<{ t: number; frame: ReturnType<typeof renderFrame> }> = [];
  const n = Math.round((scene.toSec - scene.fromSec) * SCENE_FPS);
  for (let i = 0; i <= n; i++) {
    const t = scene.fromSec + i / SCENE_FPS;
    out.push({ t, frame: renderFrame(scene, t, i * 7919 + 13) });
  }
  return out;
}

/** Lap starts for a driver who laps in `lapTimes`, beginning at `first`. */
export function lapStartsFrom(first: number, lapTimes: number[]): number[] {
  const out = [first];
  for (const d of lapTimes) out.push(out[out.length - 1]! + d);
  return out;
}
