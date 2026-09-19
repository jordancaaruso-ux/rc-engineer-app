/**
 * The pixel primitives the crossing detector runs on.
 *
 * These deliberately mirror the OpenCV calls in the validated offline probe rather than
 * doing the same thing "a reasonable way" — a half-pixel difference in a blob centroid
 * moves a detected crossing by milliseconds, which is the whole margin we are working in.
 *
 * Matched behaviours, each one a real decision:
 *  - `GaussianBlur(f, (5,5), 0)` uses OpenCV's small-kernel table, which for ksize 5 is the
 *    binomial [1,4,6,4,1]/16 — NOT a sampled Gaussian of the sigma the docs imply.
 *  - Borders reflect without repeating the edge pixel (OpenCV BORDER_REFLECT_101), and reflect
 *    off the FULL crop, so the result does not depend on how much of the crop we bother to visit.
 *  - Blob area and centroid come from the traced boundary polygon (`contourArea` / `moments`),
 *    not from counting pixels. For small blobs the two differ by tens of percent.
 *
 * Every pass takes row spans and visits nothing else — see `spans.ts` for why that is free.
 */

import type { RowSpans } from "./spans";
import type { FrameCrop } from "./types";

/** OpenCV's smallGaussianTab row for ksize 5, in 1/16ths. */
const BLUR5 = [1, 4, 6, 4, 1] as const;
const BLUR5_SUM = 16;
const BLUR5_ROUND = (BLUR5_SUM * BLUR5_SUM) >> 1;
/** And its row for ksize 3, in quarters. */
const BLUR3_SUM = 4;
const BLUR3_ROUND = (BLUR3_SUM * BLUR3_SUM) >> 1;

/**
 * Blur kernel width in pixels. 5 is the validated recipe; 3 and 1 (no blur) exist for lines
 * where the car is only a few pixels across — see `blurKernelFor` in `geometry.ts`.
 */
export type BlurKernel = 1 | 3 | 5;

/** BORDER_REFLECT_101: index -1 maps to 1, -2 to 2, len to len-2, len+1 to len-3. */
function reflect101(i: number, len: number): number {
  if (len === 1) return 0;
  let v = i;
  while (v < 0 || v >= len) {
    if (v < 0) v = -v;
    if (v >= len) v = 2 * (len - 1) - v;
  }
  return v;
}

/**
 * Separable 5-tap blur of an interleaved 8-bit image, per channel, written only where
 * `outSpans` asks for it. Integer accumulation with one rounding at the end, matching
 * OpenCV's fixed-point path.
 *
 * `scratch` is reused between frames — a window is hundreds of frames and this buffer is
 * megabytes.
 */
export function gaussianBlur5(
  src: FrameCrop,
  outSpans: RowSpans,
  horizSpans: RowSpans,
  scratch: { horiz: Int32Array; out: Uint8Array }
): FrameCrop {
  const { width: w, height: h, channels: c, data } = src;
  const { horiz, out } = scratch;

  for (let y = 0; y < h; y++) {
    const from = horizSpans.x0[y];
    const to = horizSpans.x1[y];
    if (to <= from) continue;
    const rowOff = y * w * c;
    for (let x = from; x < to; x++) {
      const xm2 = reflect101(x - 2, w) * c;
      const xm1 = reflect101(x - 1, w) * c;
      const x00 = x * c;
      const xp1 = reflect101(x + 1, w) * c;
      const xp2 = reflect101(x + 2, w) * c;
      for (let ch = 0; ch < c; ch++) {
        horiz[rowOff + x00 + ch] =
          data[rowOff + xm2 + ch] +
          4 * data[rowOff + xm1 + ch] +
          6 * data[rowOff + x00 + ch] +
          4 * data[rowOff + xp1 + ch] +
          data[rowOff + xp2 + ch];
      }
    }
  }

  for (let y = 0; y < h; y++) {
    const from = outSpans.x0[y];
    const to = outSpans.x1[y];
    if (to <= from) continue;
    const ym2 = reflect101(y - 2, h) * w * c;
    const ym1 = reflect101(y - 1, h) * w * c;
    const y00 = y * w * c;
    const yp1 = reflect101(y + 1, h) * w * c;
    const yp2 = reflect101(y + 2, h) * w * c;
    for (let x = from; x < to; x++) {
      const xc = x * c;
      for (let ch = 0; ch < c; ch++) {
        const sum =
          horiz[ym2 + xc + ch] +
          4 * horiz[ym1 + xc + ch] +
          6 * horiz[y00 + xc + ch] +
          4 * horiz[yp1 + xc + ch] +
          horiz[yp2 + xc + ch];
        out[y00 + xc + ch] = (sum + BLUR5_ROUND) / (BLUR5_SUM * BLUR5_SUM);
      }
    }
  }

  return { width: w, height: h, channels: c, data: out };
}

/** Separable 3-tap blur, same borders and rounding as the 5-tap. */
export function gaussianBlur3(
  src: FrameCrop,
  outSpans: RowSpans,
  horizSpans: RowSpans,
  scratch: { horiz: Int32Array; out: Uint8Array }
): FrameCrop {
  const { width: w, height: h, channels: c, data } = src;
  const { horiz, out } = scratch;

  for (let y = 0; y < h; y++) {
    const from = horizSpans.x0[y];
    const to = horizSpans.x1[y];
    if (to <= from) continue;
    const rowOff = y * w * c;
    for (let x = from; x < to; x++) {
      const xm1 = reflect101(x - 1, w) * c;
      const x00 = x * c;
      const xp1 = reflect101(x + 1, w) * c;
      for (let ch = 0; ch < c; ch++) {
        horiz[rowOff + x00 + ch] =
          data[rowOff + xm1 + ch] + 2 * data[rowOff + x00 + ch] + data[rowOff + xp1 + ch];
      }
    }
  }

  for (let y = 0; y < h; y++) {
    const from = outSpans.x0[y];
    const to = outSpans.x1[y];
    if (to <= from) continue;
    const ym1 = reflect101(y - 1, h) * w * c;
    const y00 = y * w * c;
    const yp1 = reflect101(y + 1, h) * w * c;
    for (let x = from; x < to; x++) {
      const xc = x * c;
      for (let ch = 0; ch < c; ch++) {
        const sum = horiz[ym1 + xc + ch] + 2 * horiz[y00 + xc + ch] + horiz[yp1 + xc + ch];
        out[y00 + xc + ch] = (sum + BLUR3_ROUND) / (BLUR3_SUM * BLUR3_SUM);
      }
    }
  }

  return { width: w, height: h, channels: c, data: out };
}

/**
 * Blur with the kernel asked for. Kernel 1 copies the pixels through untouched — copied rather
 * than aliased, because the scanner alternates two output buffers and compares this frame's
 * against the last one's.
 */
export function blurFrame(
  src: FrameCrop,
  kernel: BlurKernel,
  outSpans: RowSpans,
  horizSpans: RowSpans,
  scratch: { horiz: Int32Array; out: Uint8Array }
): FrameCrop {
  if (kernel === 5) return gaussianBlur5(src, outSpans, horizSpans, scratch);
  if (kernel === 3) return gaussianBlur3(src, outSpans, horizSpans, scratch);
  const { width: w, height: h, channels: c, data } = src;
  const { out } = scratch;
  for (let y = 0; y < h; y++) {
    const from = outSpans.x0[y];
    const to = outSpans.x1[y];
    if (to <= from) continue;
    const a = (y * w + from) * c;
    const b = (y * w + to) * c;
    out.set(data.subarray(a, b), a);
  }
  return { width: w, height: h, channels: c, data: out };
}

/**
 * Frame-to-frame motion inside the band: per-channel absolute difference, largest channel wins,
 * keep pixels strictly above `thresh`. Using the max channel rather than greyscale is what lets
 * a coloured car show up against similarly-bright tarmac.
 *
 * The band AND happens here rather than as a second pass — outside the band the answer is zero
 * either way, and this is the hottest loop in the detector.
 */
export function motionMaskInBand(
  a: FrameCrop,
  b: FrameCrop,
  thresh: number,
  band: Uint8Array,
  spans: RowSpans,
  out: Uint8Array
): Uint8Array {
  const { width: w, channels: c } = a;
  const colorCh = Math.min(3, c);
  out.fill(0);
  for (let y = 0; y < spans.h; y++) {
    const from = spans.x0[y];
    const to = spans.x1[y];
    if (to <= from) continue;
    const rowPx = y * w;
    const rowByte = rowPx * c;
    for (let x = from; x < to; x++) {
      if (!band[rowPx + x]) continue;
      const i = rowByte + x * c;
      let maxDiff = 0;
      for (let ch = 0; ch < colorCh; ch++) {
        const d = Math.abs(b.data[i + ch] - a.data[i + ch]);
        if (d > maxDiff) maxDiff = d;
      }
      if (maxDiff > thresh) out[rowPx + x] = 1;
    }
  }
  return out;
}

/**
 * The same motion mask, with a second question asked of every band pixel: does it differ from
 * what this spot looks like with nothing on it? Frame-to-frame difference measures CHANGE, so
 * its signal is proportional to speed: a car four pixels long moving two pixels a frame changes
 * half of itself per frame, and against a surface near its own tone that is 6–7 levels after
 * the blur — under any gate that keeps sensor noise out (Bendigo S1, 2026-09-02: one car seen
 * on 8 of 10 laps, the other never). Against the learnt empty track the same car reads its full
 * contrast every frame, however slowly it moves. Either test admits the pixel.
 *
 * `bg` is the blurred background in the same channels as the frames, or null before it exists.
 *
 * The mask says which test admitted each pixel — 1 for a frame-to-frame change, 2 for a
 * difference from the background alone — because the background must be learnt from the first
 * and not the second. A thing that arrives in the band and then stands still (a marshal, a
 * parked car, the camera settling after a nudge) differs from the background for as long as the
 * background is not updated where it stands; if being different is what stops the update, it is
 * flagged forever, and the far end of Bendigo S1 filled with static blobs a thousand pixels
 * across that flipped sides every frame (2026-09-02). Only a frame-to-frame change is allowed
 * to defend a pixel from being learnt as background.
 */
export function motionMaskInBandBg(
  a: FrameCrop,
  b: FrameCrop,
  thresh: number,
  bg: Float32Array | null,
  bgThresh: number,
  band: Uint8Array,
  spans: RowSpans,
  out: Uint8Array
): Uint8Array {
  const { width: w, channels: c } = a;
  const colorCh = Math.min(3, c);
  out.fill(0);
  for (let y = 0; y < spans.h; y++) {
    const from = spans.x0[y];
    const to = spans.x1[y];
    if (to <= from) continue;
    const rowPx = y * w;
    const rowByte = rowPx * c;
    for (let x = from; x < to; x++) {
      if (!band[rowPx + x]) continue;
      const i = rowByte + x * c;
      let maxDiff = 0;
      for (let ch = 0; ch < colorCh; ch++) {
        const d = Math.abs(b.data[i + ch] - a.data[i + ch]);
        if (d > maxDiff) maxDiff = d;
      }
      if (maxDiff > thresh) {
        out[rowPx + x] = 1;
        continue;
      }
      if (!bg) continue;
      const q = (rowPx + x) * 3;
      let bgDiff = 0;
      for (let ch = 0; ch < colorCh; ch++) {
        const d = Math.abs(b.data[i + ch] - bg[q + ch]);
        if (d > bgDiff) bgDiff = d;
      }
      // 3: differs from the background AND changed a little this frame — under the gate, but
      // above half of it. That is what a crawling car looks like, and it is enough to say the
      // pixel is part of something moving; a 2 on its own is not.
      if (bgDiff > bgThresh) out[rowPx + x] = maxDiff * 2 > thresh ? 3 : 2;
    }
  }
  return out;
}

/**
 * Dilate with a full 5x5 rectangle, `iterations` times. A rectangular structuring element is
 * separable, so each pass runs as a horizontal then a vertical max. Out-of-bounds counts as
 * background, which is OpenCV's dilate border default.
 *
 * `spansPerIteration[i]` must cover everywhere the mask can be non-zero after iteration i+1.
 */
export function dilate5(
  mask: Uint8Array,
  w: number,
  h: number,
  spansPerIteration: RowSpans[],
  buffers: { a: Uint8Array; b: Uint8Array; horiz: Uint8Array }
): Uint8Array {
  let cur = mask;
  for (let it = 0; it < spansPerIteration.length; it++) {
    const spans = spansPerIteration[it];
    // `horiz` is its own buffer, not part of the a/b ping-pong: on the second pass the
    // ping-pong partner IS the current mask, and clearing it would erase the input.
    const horiz = buffers.horiz;
    const out = it % 2 === 0 ? buffers.a : buffers.b;
    horiz.fill(0);
    out.fill(0);

    for (let y = 0; y < h; y++) {
      const from = spans.x0[y];
      const to = spans.x1[y];
      if (to <= from) continue;
      const off = y * w;
      for (let x = from; x < to; x++) {
        const lo = Math.max(0, x - 2);
        const hi = Math.min(w - 1, x + 2);
        for (let xx = lo; xx <= hi; xx++) {
          if (cur[off + xx]) {
            horiz[off + x] = 1;
            break;
          }
        }
      }
    }
    for (let y = 0; y < h; y++) {
      const from = spans.x0[y];
      const to = spans.x1[y];
      if (to <= from) continue;
      const lo = Math.max(0, y - 2);
      const hi = Math.min(h - 1, y + 2);
      for (let x = from; x < to; x++) {
        for (let yy = lo; yy <= hi; yy++) {
          if (horiz[yy * w + x]) {
            out[y * w + x] = 1;
            break;
          }
        }
      }
    }
    cur = out;
  }
  return cur;
}

export type Blob = {
  /** |contourArea| of the traced outer boundary. */
  area: number;
  /** Boundary-polygon centroid, in crop pixel coords. */
  cx: number;
  cy: number;
  /** Length of the traced boundary. */
  perimeter: number;
  /**
   * 4·pi·area / perimeter², i.e. 1 for a circle and near 0 for a ribbon. Codec ringing hugs
   * painted edges and comes out long and thin; a car is a filled lump. This is what separates
   * them when neither size, speed, nor how often a pixel fires can.
   */
  compactness: number;
};

/** 8-neighbour offsets in clockwise order, starting west. */
const NEIGH: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
];

function neighbourIndex(dx: number, dy: number): number {
  for (let i = 0; i < 8; i++) if (NEIGH[i][0] === dx && NEIGH[i][1] === dy) return i;
  return 0;
}

/**
 * Outer boundaries of every 8-connected foreground component, as OpenCV's
 * `findContours(..., RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)` would give them — traced over pixel
 * centres, so a lone pixel yields a zero-area contour and is discarded exactly as the probe
 * discarded it.
 */
/**
 * @param support Optional undilated motion mask (`motionMaskInBandBg`). When given, a blob with
 *        no pixel that actually changed this frame (value 1 or 3) is not returned: it is a
 *        patch that differs from the background and nothing more — a thing that stopped, a
 *        shadow the light moved, the codec settling — and a crossing is by definition a car in
 *        motion. The background test is allowed to fill a moving car out, never to invent one.
 */
export function findBlobs(
  mask: Uint8Array,
  w: number,
  h: number,
  minArea: number,
  spans: RowSpans,
  seen: Uint8Array,
  stack: Int32Array,
  support?: Uint8Array
): Blob[] {
  seen.fill(0);
  const blobs: Blob[] = [];
  const moved = (p: number) => support![p] === 1 || support![p] === 3;

  for (let sy = 0; sy < h; sy++) {
    const from = spans.x0[sy];
    const to = spans.x1[sy];
    if (to <= from) continue;
    for (let sx = from; sx < to; sx++) {
      const start = sy * w + sx;
      if (!mask[start] || seen[start]) continue;

      // Flood the component first so it is never traced twice; scan order guarantees this
      // pixel is on the component's outer boundary.
      let sp = 0;
      let supported = !support || moved(start);
      stack[sp++] = start;
      seen[start] = 1;
      while (sp > 0) {
        const p = stack[--sp];
        const px = p % w;
        const py = (p - px) / w;
        for (let k = 0; k < 8; k++) {
          const nx = px + NEIGH[k][0];
          const ny = py + NEIGH[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx;
          if (mask[np] && !seen[np]) {
            seen[np] = 1;
            if (!supported && moved(np)) supported = true;
            if (sp < stack.length) stack[sp++] = np;
          }
        }
      }
      if (!supported) continue;

      const contour = traceBoundary(mask, w, h, sx, sy);
      const blob = polygonBlob(contour);
      if (blob && blob.area >= minArea) blobs.push(blob);
    }
  }
  return blobs;
}

/** Moore-neighbour boundary trace with Jacob's stopping criterion. */
function traceBoundary(
  mask: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number
): Array<[number, number]> {
  const isFg = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;

  const contour: Array<[number, number]> = [[sx, sy]];
  let bx = sx;
  let by = sy;
  let backX = sx - 1;
  let backY = sy;
  let firstStep: [number, number] | null = null;
  const guardLimit = 8 * (w + h) + 64;

  for (let guard = 0; guard < guardLimit; guard++) {
    const idx = neighbourIndex(backX - bx, backY - by);
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = NEIGH[(idx + k) % 8];
      const nx = bx + d[0];
      const ny = by + d[1];
      if (isFg(nx, ny)) {
        const prev = NEIGH[(idx + k - 1) % 8];
        backX = bx + prev[0];
        backY = by + prev[1];
        bx = nx;
        by = ny;
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel

    const last = contour[contour.length - 1];
    if (firstStep && bx === firstStep[0] && by === firstStep[1] && last[0] === sx && last[1] === sy) {
      break;
    }
    if (!firstStep) firstStep = [bx, by];
    contour.push([bx, by]);
  }
  return contour;
}

/** Polygon area and centroid via the same moment sums OpenCV uses for a point contour. */
function polygonBlob(contour: Array<[number, number]>): Blob | null {
  if (contour.length < 3) return null;
  let m00 = 0;
  let m10 = 0;
  let m01 = 0;
  let perimeter = 0;
  for (let i = 0; i < contour.length; i++) {
    const [x0, y0] = contour[i];
    const [x1, y1] = contour[(i + 1) % contour.length];
    const a = x0 * y1 - x1 * y0;
    m00 += a;
    m10 += a * (x0 + x1);
    m01 += a * (y0 + y1);
    perimeter += Math.hypot(x1 - x0, y1 - y0);
  }
  m00 /= 2;
  if (m00 === 0) return null;
  m10 /= 6;
  m01 /= 6;
  const area = Math.abs(m00);
  return {
    area,
    cx: m10 / m00,
    cy: m01 / m00,
    perimeter,
    compactness: perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
  };
}
