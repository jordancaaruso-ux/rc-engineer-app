/**
 * Footage we know the truth about.
 *
 * The detector has been judged, twice, against one 4K heat filmed from one place — 15 crossings
 * marked by hand. Every other session's "marks" are the detector's own accepted output, so
 * scoring against them is marking its own homework. That test set cannot say whether a change
 * works on a phone clip, a fisheye, a camera further back, or the far end of a big track, which
 * is exactly what a recipe has to survive (Jordan, 2026-09-01: "we need to build a framework
 * that works for any video").
 *
 * So: build the frames. A car is a block of known size crossing a line of known geometry at a
 * known moment, over a fixed background with a little noise. Nothing here is a picture of a real
 * track, and it is not meant to be — real footage tests whether the detector survives kerbing,
 * shake and glare, while this tests whether the GEOMETRY holds at any scale, resolution and
 * frame rate. The failures this catches are the ones the single-video harness cannot see: a band
 * measured in frame pixels is a car wide at one distance and a whole hairpin wide at another.
 *
 * The scanner takes decoded crops, so no video file, no ffmpeg, and no marking is involved.
 */

import { lineGeom, roiFor } from "./geometry";
import type { FrameCrop, SectorLine } from "./types";

export type Scene = {
  /** Full frame the line's fractions are measured against. */
  frameW: number;
  frameH: number;
  line: SectorLine;
  /** Apparent length of a car at this line, in frame pixels. */
  carPx: number;
  /** How far a car moves between two frames, in frame pixels. */
  speedPxPerFrame: number;
  fps: number;
  /** Where along the line the car crosses: 0 at the first end, 1 at the second. */
  crossAt: number;
  /** Video time of the crossing, seconds. */
  trueSec: number;
  /** Frames either side of the crossing. */
  halfFrames?: number;
  /** ±amplitude of per-pixel noise added to every frame. */
  noise?: number;
  /**
   * A second car on a parallel path this many pixels beyond the near end of the line, running
   * the other way — the return lane of a hairpin. It must never be reported as this line's
   * crossing, and it is what a band measured in frame pixels swallows at the far end of a track.
   */
  distractorBeyondEndPx?: number;
  /** Leave the crossing car out entirely — for asking whether the OTHER car gets reported. */
  omitCar?: boolean;
};

/** Deterministic noise — a test that flickers is worse than no test. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SyntheticClip = {
  roi: { x0: number; y0: number; x1: number; y1: number };
  frames: Array<{ crop: FrameCrop; t: number }>;
  trueSec: number;
};

/**
 * Render one crossing as a sequence of ROI crops.
 *
 * The car travels perpendicular to the line, through the point `crossAt` along it, and is at the
 * line exactly at `trueSec`. Everything else in the picture is static, so any motion the
 * detector finds is a car by construction.
 */
export function renderScene(scene: Scene): SyntheticClip {
  const {
    frameW,
    frameH,
    line,
    carPx,
    speedPxPerFrame,
    fps,
    crossAt,
    trueSec,
    halfFrames = 20,
    noise = 3,
    distractorBeyondEndPx,
    omitCar = false,
  } = scene;

  const g = lineGeom(line, frameW, frameH);
  const roi = roiFor(line, frameW, frameH);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const ux = g.dx / g.norm;
  const uy = g.dy / g.norm;
  // Perpendicular to the line: the direction a car actually travels through it.
  const nx = -uy;
  const ny = ux;

  // A fixed, textured background. Flat grey would let a one-count of noise look like a car;
  // texture is what a real crop has, and it must cancel exactly between frames.
  const rnd = mulberry32(20260901);
  const bg = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const base = 70 + Math.floor(rnd() * 60);
    bg[i * 3] = base;
    bg[i * 3 + 1] = base + 4;
    bg[i * 3 + 2] = base + 9;
  }

  const centreX = g.p1x + g.dx * crossAt;
  const centreY = g.p1y + g.dy * crossAt;
  // The distractor sits beyond the near end of the line, on a parallel path, running the other
  // way — same geometry as a hairpin's return leg.
  const distX = g.p1x - ux * (distractorBeyondEndPx ?? 0);
  const distY = g.p1y - uy * (distractorBeyondEndPx ?? 0);

  const noiseRnd = mulberry32(7);
  const frames: SyntheticClip["frames"] = [];
  const half = Math.floor(carPx / 2);

  for (let f = -halfFrames; f <= halfFrames; f++) {
    const t = trueSec + f / fps;
    const data = new Uint8Array(bg);
    if (noise > 0) {
      for (let i = 0; i < data.length; i++) {
        const d = Math.round((noiseRnd() * 2 - 1) * noise);
        data[i] = Math.max(0, Math.min(255, data[i]! + d));
      }
    }

    const paint = (cx: number, cy: number, r: number, gr: number, b: number) => {
      for (let dy = -half; dy <= half; dy++) {
        const y = Math.round(cy + dy) - roi.y0;
        if (y < 0 || y >= h) continue;
        for (let dx = -half; dx <= half; dx++) {
          const x = Math.round(cx + dx) - roi.x0;
          if (x < 0 || x >= w) continue;
          const i = (y * w + x) * 3;
          data[i] = r;
          data[i + 1] = gr;
          data[i + 2] = b;
        }
      }
    };

    const travel = f * speedPxPerFrame;
    if (!omitCar) paint(centreX + nx * travel, centreY + ny * travel, 230, 60, 40);
    if (distractorBeyondEndPx != null) {
      paint(distX - nx * travel, distY - ny * travel, 40, 90, 220);
    }

    frames.push({ crop: { width: w, height: h, channels: 3, data }, t });
  }

  return { roi, frames, trueSec };
}
