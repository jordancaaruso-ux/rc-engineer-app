/**
 * A lap we know the truth about, for the tracer.
 *
 * A car is a block of known size on a known path over a fixed, textured, slightly noisy
 * background, exactly as `findCrossings/synthetic.ts` does for a single crossing. Frames are
 * rendered whole and read through whatever window the tracer asks for, so the moving-window
 * arithmetic is exercised the way the browser exercises it. Nothing here looks like a track,
 * and it is not meant to: real footage tests kerbs and glare, this tests the geometry.
 */

import type { FrameCrop, Roi } from "../findCrossings/types";

export type Xy = { x: number; y: number };

export type PathScene = {
  frameW: number;
  frameH: number;
  fps: number;
  /** Video time of frame 0. */
  startSec: number;
  seconds: number;
  carPx: number;
  path: (t: number) => Xy;
  colour?: [number, number, number];
  /** A second car, with its own path and paint. */
  rival?: { path: (t: number) => Xy; carPx: number; colour: [number, number, number] };
  /** When the car is not painted at all — behind a board. */
  hidden?: (t: number) => boolean;
  /** Whole-frame shift, pixels, for a given frame — the camera being nudged. */
  shakeAt?: (frame: number) => number;
  noise?: number;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RenderedScene = {
  frames: number;
  tAt: (frame: number) => number;
  /** The window's pixels for one frame, RGBA. A fresh buffer each call. */
  readWindow: (frame: number, roi: Roi) => FrameCrop;
  truth: (t: number) => Xy;
};

export function renderPathScene(scene: PathScene): RenderedScene {
  const { frameW: w, frameH: h, fps, startSec, seconds, carPx, path, rival, hidden, shakeAt, noise = 3 } = scene;
  const frames = Math.round(seconds * fps);
  const colour = scene.colour ?? [230, 60, 40];

  // Blocks a few pixels across, not per-pixel grain: a real track's texture is paint edges,
  // kerbs and joins, which a blur leaves standing. Per-pixel noise blurs away, and then a
  // shaken frame differs from the one before it by less than a car does.
  const rnd = mulberry32(20260906);
  const BLOCK = 4;
  const gw = Math.ceil(w / BLOCK);
  const gh = Math.ceil(h / BLOCK);
  const blocks = new Uint8Array(gw * gh);
  for (let i = 0; i < blocks.length; i++) blocks[i] = 70 + Math.floor(rnd() * 60);
  const bg = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const base = blocks[Math.floor(y / BLOCK) * gw + Math.floor(x / BLOCK)]!;
      bg[i * 4] = base;
      bg[i * 4 + 1] = base + 4;
      bg[i * 4 + 2] = base + 9;
      bg[i * 4 + 3] = 255;
    }
  }

  let cached = -1;
  const full = new Uint8Array(w * h * 4);
  const noiseRnd = mulberry32(7);

  const paint = (c: Xy, len: number, rgb: [number, number, number]) => {
    const hw = Math.floor(len / 2);
    const hh = Math.max(1, Math.floor(len * 0.3));
    for (let dy = -hh; dy <= hh; dy++) {
      const y = Math.round(c.y + dy);
      if (y < 0 || y >= h) continue;
      for (let dx = -hw; dx <= hw; dx++) {
        const x = Math.round(c.x + dx);
        if (x < 0 || x >= w) continue;
        const i = (y * w + x) * 4;
        full[i] = rgb[0];
        full[i + 1] = rgb[1];
        full[i + 2] = rgb[2];
      }
    }
  };

  const render = (frame: number) => {
    if (cached === frame) return;
    cached = frame;
    const t = startSec + frame / fps;
    const shift = shakeAt ? shakeAt(frame) : 0;
    if (shift) {
      // The whole picture moves: every row copied from `shift` pixels over.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = Math.max(0, Math.min(w - 1, x - shift));
          full.set(bg.subarray((y * w + sx) * 4, (y * w + sx) * 4 + 4), (y * w + x) * 4);
        }
      }
    } else {
      full.set(bg);
    }
    if (noise > 0) {
      for (let i = 0; i < full.length; i += 4) {
        const d = Math.round((noiseRnd() * 2 - 1) * noise);
        for (let ch = 0; ch < 3; ch++) full[i + ch] = Math.max(0, Math.min(255, full[i + ch]! + d));
      }
    }
    if (!hidden?.(t)) {
      const c = path(t);
      paint({ x: c.x + shift, y: c.y }, carPx, colour);
    }
    if (rival) {
      const c = rival.path(t);
      paint({ x: c.x + shift, y: c.y }, rival.carPx, rival.colour);
    }
  };

  return {
    frames,
    tAt: (frame) => startSec + frame / fps,
    truth: path,
    readWindow: (frame, roi) => {
      render(frame);
      const cw = roi.x1 - roi.x0;
      const ch = roi.y1 - roi.y0;
      const data = new Uint8Array(cw * ch * 4);
      for (let y = 0; y < ch; y++) {
        const src = ((roi.y0 + y) * w + roi.x0) * 4;
        data.set(full.subarray(src, src + cw * 4), y * cw * 4);
      }
      return { width: cw, height: ch, channels: 4, data };
    },
  };
}

/** An ellipse driven at a speed that rises on the long sides and falls in the ends. */
export function ellipseLap(cx: number, cy: number, rx: number, ry: number, lapSec: number, startSec: number) {
  return (t: number): Xy => {
    const u = (t - startSec) / lapSec;
    // Angle advances unevenly: quick along the straights, slow in the "corners".
    const th = 2 * Math.PI * u + 0.35 * Math.sin(4 * Math.PI * u);
    return { x: cx + rx * Math.cos(th), y: cy + ry * Math.sin(th) };
  };
}
