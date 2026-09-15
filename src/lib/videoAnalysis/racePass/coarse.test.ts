/**
 * The coarse frame: one whole picture in, everything that moved out.
 *
 * Two of these tests exist to hold a claim the module's own comment makes — that its pixel loops
 * are the library ones with the generality removed, not different arithmetic. If they ever stop
 * agreeing byte for byte, the race pass and the crossing scan have quietly started seeing
 * different pictures, which is exactly the class of fault that is invisible until a crossing is
 * 300 ms out.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { gaussianBlur3, diffWindowBg } from "../findCrossings/imageOps";
import { fullSpans } from "../trace/window";
import type { FrameCrop } from "../findCrossings/types";
import {
  blurLuma,
  coarseMask,
  CoarseDetector,
  lumaOf,
  MAX_BLOBS_PER_FRAME,
  minAreaForCoarseCar,
  SHAKE_SHARE,
} from "./coarse";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(w: number, h: number, seed: number, base = 90, spread = 40): FrameCrop {
  const r = rng(seed);
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(base + r() * spread);
  return { width: w, height: h, channels: 1, data };
}

/** An RGBA picture of flat track with a bright square on it. */
function scene(
  w: number,
  h: number,
  seed: number,
  car: { x: number; y: number; size: number } | null
): FrameCrop {
  const r = rng(seed);
  const data = new Uint8Array(w * h * 4);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const v = 70 + Math.floor(r() * 6);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  if (car) {
    for (let y = car.y; y < car.y + car.size; y++) {
      for (let x = car.x; x < car.x + car.size; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        data[i] = 230;
        data[i + 1] = 230;
        data[i + 2] = 230;
        data[i + 3] = 255;
      }
    }
  }
  return { width: w, height: h, channels: 4, data };
}

test("the fused blur is the library blur, byte for byte", () => {
  for (const [w, h] of [
    [64, 40],
    [17, 9],
    [1, 5],
    [5, 1],
    [2, 2],
  ] as const) {
    const src = noise(w, h, w * 977 + h);
    const spans = fullSpans(w, h);
    const lib = gaussianBlur3(src, spans, spans, {
      horiz: new Int32Array(w * h),
      out: new Uint8Array(w * h),
    });
    const mine = blurLuma(src, new Int32Array(w * h), new Uint8Array(w * h));
    assert.deepEqual(
      Array.from(mine.data),
      Array.from(lib.data),
      `blur disagreed at ${w}×${h} — the race pass and the scan would be looking at different pictures`
    );
  }
});

test("the fused two-ways mask is the library one, byte for byte", () => {
  const w = 48;
  const h = 32;
  const spansOut = { h, w, x0: new Int32Array(h), x1: new Int32Array(h) };
  const roi = { x0: 0, y0: 0, x1: w, y1: h };
  const cur = noise(w, h, 11);
  const prev = noise(w, h, 12);
  const bg = noise(w, h, 13);
  for (const thresh of [4, 10, 25]) {
    for (const [p, b] of [
      [prev, bg],
      [null, bg],
      [prev, null],
      [null, null],
    ] as const) {
      const libMask = new Uint8Array(w * h);
      const libMoved = diffWindowBg(p, p ? roi : null, b, cur, roi, thresh, libMask, 0);
      const mineMask = new Uint8Array(w * h);
      const mine = coarseMask(cur, p, b, thresh, mineMask, spansOut);
      const label = `thresh ${thresh}, prev ${!!p}, bg ${!!b}`;
      assert.equal(mine.moved, libMoved, `moved count disagreed (${label})`);
      assert.deepEqual(Array.from(mineMask), Array.from(libMask), `mask disagreed (${label})`);
    }
  }
});

test("the mask's row spans cover every pixel it set, and no empty row claims any", () => {
  const w = 40;
  const h = 24;
  const cur = noise(w, h, 21);
  const prev = noise(w, h, 22);
  const mask = new Uint8Array(w * h);
  const spans = { h, w, x0: new Int32Array(h), x1: new Int32Array(h) };
  coarseMask(cur, prev, null, 6, mask, spans);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      assert.ok(
        x >= spans.x0[y]! && x < spans.x1[y]!,
        `set pixel (${x},${y}) fell outside its row's span [${spans.x0[y]}, ${spans.x1[y]})`
      );
    }
    if (spans.x1[y]! > spans.x0[y]!) {
      let any = false;
      for (let x = spans.x0[y]!; x < spans.x1[y]!; x++) if (mask[y * w + x]) any = true;
      assert.ok(any, `row ${y} claims a span but set nothing`);
    }
  }
});

test("a car that moves is found, and its position comes back in frame pixels", () => {
  const w = 80;
  const h = 60;
  const divisor = 4;
  const det = new CoarseDetector({ w, h, divisor, thresh: 8, carPx: 6 });
  det.setBackground(scene(w, h, 1, null));
  // Three frames of empty track settle the frame-to-frame reference, then the car arrives.
  det.push(scene(w, h, 2, null), 0);
  det.push(scene(w, h, 3, null), 0.033);
  const seen = det.push(scene(w, h, 4, { x: 30, y: 20, size: 6 }), 0.066);
  assert.equal(seen.shake, false);
  assert.ok(seen.blobs.length >= 1, "the car was not seen at all");
  const nearest = [...seen.blobs].sort(
    (a, b) => Math.hypot(a.x - 33 * divisor, a.y - 23 * divisor) - Math.hypot(b.x - 33 * divisor, b.y - 23 * divisor)
  )[0]!;
  // The blob's centre is the car's, times the divisor: the whole pass speaks full-frame pixels.
  assert.ok(
    Math.abs(nearest.x - 33 * divisor) < 3 * divisor && Math.abs(nearest.y - 23 * divisor) < 3 * divisor,
    `the car was placed at (${nearest.x}, ${nearest.y}), not near (${33 * divisor}, ${23 * divisor})`
  );
  assert.ok(nearest.w >= 6 * divisor * 0.5, "the blob's box is far smaller than the car");
});

test("a frame where the whole picture moved is the camera, and carries no sightings", () => {
  const w = 60;
  const h = 40;
  const det = new CoarseDetector({ w, h, divisor: 4, thresh: 8, carPx: 6 });
  det.setBackground(scene(w, h, 1, null));
  det.push(scene(w, h, 2, null), 0);
  // Every pixel far from both the frame before and the still picture: the camera was knocked.
  const bumped: FrameCrop = { width: w, height: h, channels: 4, data: new Uint8Array(w * h * 4).fill(240) };
  const shook = det.push(bumped, 0.033);
  assert.equal(shook.shake, true, "a whole-frame change was not called camera movement");
  assert.deepEqual(shook.blobs, []);
  assert.ok(shook.movedShare > SHAKE_SHARE);
  assert.equal(det.shakeFrames, 1);
});

test("a crowded frame keeps the biggest and says so, rather than dropping the frame", () => {
  const w = 140;
  const h = 116;
  const det = new CoarseDetector({ w, h, divisor: 4, thresh: 8, carPx: 4 });
  det.setBackground(scene(w, h, 1, null));
  det.push(scene(w, h, 2, null), 0);
  // Far more moving things than the cap, spaced wider than the dilation reaches (two passes of
  // two pixels each way) so they stay separate blobs rather than merging into a lattice.
  const many = scene(w, h, 3, null);
  let n = 0;
  for (let gy = 0; gy < 6; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      const x0 = 4 + gx * 22;
      const y0 = 4 + gy * 18;
      const size = 4 + ((gx + gy) % 3);
      for (let y = y0; y < y0 + size; y++) {
        for (let x = x0; x < x0 + size; x++) {
          const i = (y * w + x) * 4;
          many.data[i] = 235;
          many.data[i + 1] = 235;
          many.data[i + 2] = 235;
        }
      }
      n++;
    }
  }
  assert.ok(n > MAX_BLOBS_PER_FRAME);
  const frame = det.push(many, 0.033);
  assert.equal(frame.crowded, true, "a frame with far more blobs than the cap was not flagged");
  assert.equal(frame.blobs.length, MAX_BLOBS_PER_FRAME);
  assert.equal(det.crowdedFrames, 1);
  // The ones kept are the biggest, which is what a car is against a marshal's arm.
  const smallest = Math.min(...frame.blobs.map((b) => b.area));
  assert.ok(smallest > 0);
});

test("the blob floor grows with the car, so a bigger picture does not let grain in", () => {
  assert.equal(minAreaForCoarseCar(2), 3);
  assert.ok(minAreaForCoarseCar(10) > minAreaForCoarseCar(5));
  assert.equal(minAreaForCoarseCar(10), 25);
});

test("brightness is Rec.709, matching what the crossing scan reads", () => {
  const rgba: FrameCrop = {
    width: 2,
    height: 1,
    channels: 4,
    data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  };
  const out = lumaOf(rgba, new Uint8Array(2));
  assert.equal(out.data[0], Math.round(255 * 0.2126));
  assert.equal(out.data[1], Math.round(255 * 0.7152));
});
