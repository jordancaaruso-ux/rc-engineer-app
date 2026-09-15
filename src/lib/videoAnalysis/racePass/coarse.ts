/**
 * One frame of the race, whole, turned into everything that moved in it.
 *
 * The crossing scan reads a thin strip along each drawn line, a few hundred pixels a frame. The
 * race pass has to see the whole track, because it is not looking for one driver's car at one
 * line — it is looking for every moving thing anywhere, so that the timing sheet can say which of
 * them was whose. That is a different cost problem, and step 0 of `VIDEO_RACE_PASS_PLAN.md`
 * measured it on the real 4K footage before a line of this was written.
 *
 * **What the measurement said** (IMG_4521, 3840×2160, real Chrome, 2026-09-08, 200 frames a pass):
 *
 * | | |
 * |---|---|
 * | quarter-scale readback (`drawImage` + `getImageData`) | 3.5 ms |
 * | the same work through the general-purpose pixel helpers | 45.1 ms |
 * | …on brightness instead of colour | 32.7 ms |
 * | …spreading the mask only over the rows that hold any of it | 19.6 ms |
 *
 * Three things came out of that, and each is a rule here:
 *
 * 1. **Brightness, not colour.** The crossing scan already reads brightness on nearly every line
 *    (`calibrate.ts`), and the blur and the difference both cost per channel: four to one is
 *    where a third of the time went.
 * 2. **Blur anyway.** Drawing a 4K frame down to a quarter box-filters it, so it is tempting to
 *    drop the blur — and it is 6 ms. Measured, that costs **74 blobs a frame against 7.9**: the
 *    downscale is not enough, grain fires, and the tracer then steers onto grain and shrinks its
 *    own idea of the car until nothing is left. That death spiral emptied three sectors on
 *    2026-09-07 and it is not being paid for again to save six milliseconds.
 * 3. **Spread the mask only where the mask is.** Four hundredths of one per cent of a frame
 *    moves. Taking the row spans off the mask itself takes the dilation from 12.7 ms to 0.2 ms
 *    and changes nothing about the answer.
 *
 * What was left after those was 19.6 ms, all of it in two loops that are general where this is
 * particular: `gaussianBlur3` walks an interleaved image of any channel count, and `diffWindowBg`
 * carries the arithmetic for two crops cut from *different places* in the frame, because that is
 * what a window that follows a car needs. Here the picture is one channel and the rectangle is
 * the whole frame and never moves, so both are written out again below — same arithmetic, none of
 * the generality. That is the whole reason this file has pixel loops of its own.
 *
 * Everything here is DOM-free: pixels in, blobs out. The browser side lives in `browserRace.ts`.
 */

import { dilate5, findBlobs } from "../findCrossings/imageOps";
import type { RowSpans } from "../findCrossings/spans";
import type { FrameCrop, SectorLine } from "../findCrossings/types";
import type { Obs, ObsFrame } from "../trace/chain";

/**
 * How much smaller the coarse picture is than the frame.
 *
 * Four. At 4K that is 960×540 and a car that is 20 px across reads as 5 — enough to be a blob,
 * and the precision never comes from here anyway: a crossing's moment is read off the
 * full-resolution strip at the line (`browserRace.ts`). An eighth reads faster still (2.1 ms
 * against 3.5) but puts the same car at 2.5 px, which `findBlobs` traces as a contour of almost
 * no area — below the floor that keeps grain out. A 1080p frame comes down to 480×270, where a
 * car near the camera is 5–10 px and the far one is gone; that far car is the fallback's job and
 * always was.
 */
export const COARSE_DIVISOR = 4;

/**
 * How wide the coarse picture should be, whatever the frame is.
 *
 * A fixed quarter is right for 4K and wrong for everything else, because what decides whether a
 * car can be followed is **how many pixels the car has**, not what fraction of the frame it is.
 * The Boronia race is exported at 1376×600; a fixed quarter reduces it to 344×150, where a car
 * near the camera is fourteen pixels and one at the far end is three. Paths there died every six
 * tenths of a second (2026-09-08) because the car simply was not seen often enough to be followed.
 *
 * Aiming for a picture about this wide gives 4K a quarter, 1080p a half, and a small export no
 * reduction at all — and the pixel work costs the same in every case, because it is the coarse
 * picture that is being worked on.
 */
export const COARSE_TARGET_W = 960;

/** How much to shrink a frame by so the coarse picture is about `COARSE_TARGET_W` across. */
export function coarseDivisorFor(frameW: number): number {
  return Math.max(1, Math.min(COARSE_DIVISOR, Math.round(frameW / COARSE_TARGET_W)));
}

/** Rec.709, as `browserScan.ts` recovers brightness from RGBA. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** 3-tap Gaussian, matching `gaussianBlur3`: [1 2 1] each way, 16ths, rounded once. */
const BLUR3_SUM = 4;
const BLUR3_ROUND = (BLUR3_SUM * BLUR3_SUM) >> 1;

/**
 * How far past the gate a pixel must sit to be called a car on the still picture alone.
 * `imageOps.ts` uses the same multiple where a window has just uncovered new ground.
 */
const BG_ALONE_MULTIPLE = 2;

/**
 * Share of the coarse frame that has to differ before the frame is the camera moving rather than
 * cars moving in it.
 *
 * A share, never a blob count: against a still picture of the empty track a nudged camera lights
 * up every edge in shot as one enormous connected region, which counts as *one* blob, so counting
 * them says nothing (measured 2026-09-07, four sectors' frames thrown away by the blob-count
 * version). On this footage a quiet frame moves 0.04 % and a whole field moves well under 1 %.
 */
export const SHAKE_SHARE = 0.3;

/**
 * Most blobs kept from one frame, biggest first.
 *
 * A whole field is six or eight cars; the rest of what a still picture picks up on a busy frame
 * is marshals, the board, and flags. Twenty-four leaves room for all of it and caps the linker's
 * work, which is quadratic in blobs per frame. A frame over the cap is kept and flagged, never
 * dropped: it is exactly the moment a race is most crowded.
 */
export const MAX_BLOBS_PER_FRAME = 24;

/** Smallest blob that can be a car, in coarse pixels of contour area. */
export function minAreaForCoarseCar(carPx: number): number {
  return Math.max(3, Math.round(carPx * carPx * 0.25));
}

/** Signal must be twice the picture's own noise, as everywhere else here (`calibrate.ts`). */
const NOISE_MULTIPLE = 2;
/** The floor the crossing scan uses for brightness. Below this nothing is a car anywhere. */
const MIN_COARSE_THRESH = 5;

/**
 * How much a quiet coarse frame differs from the one before it — the 99th percentile of the
 * whole picture, one number per pair of frames.
 *
 * The same measurement `bandFrameDiffs` makes for a line's band, over the whole picture instead.
 * Ninety-ninth rather than an average because a handful of cars is a per cent of nothing: on a
 * 960×540 picture, five cars twelve pixels across cover under a fifth of one per cent, so the
 * ninety-ninth percentile is the track and the trees, which is exactly what has to be gated out.
 */
export function coarseFrameDiffs(frames: ReadonlyArray<FrameCrop>): number[] {
  if (frames.length < 3) return [];
  const { width: w, height: h } = frames[0]!;
  const px = w * h;
  const horiz = new Int32Array(px);
  const bufs = [new Uint8Array(px), new Uint8Array(px)];
  const lumaBuf = new Uint8Array(px);
  const blurred = frames.map((f, i) => blurLuma(lumaOf(f, lumaBuf), horiz, bufs[i % 2]!).data.slice(0, px));
  const hist = new Uint32Array(256);
  const out: number[] = [];
  for (let f = 1; f < blurred.length; f++) {
    hist.fill(0);
    const a = blurred[f - 1]!;
    const b = blurred[f]!;
    for (let i = 0; i < px; i++) {
      const d = b[i]! - a[i]!;
      hist[d < 0 ? -d : d]!++;
    }
    let cum = 0;
    for (let v = 0; v < 256; v++) {
      cum += hist[v]!;
      if (cum >= px * 0.99) {
        out.push(v);
        break;
      }
    }
  }
  return out;
}

/**
 * The gate the coarse picture should be read at, from clips of it.
 *
 * **Not the gentlest line's gate.** That was the first cut and it is wrong by a mile: a line's
 * band is a few hundred pixels of tarmac, calibrated so a faint car crossing THERE is not missed,
 * and on the Bendigo footage those gates come out at 5. Applied to a whole 4K frame, 5 lets in
 * the trees, the drivers' stand, the spectators and the grain — measured 2026-09-08, that gave
 * over twenty-four blobs a frame on a third of the frames, **7 865 tracklets and 7 949 merges**
 * for four cars, and every path was shredded before it could be read. The naming still worked
 * (six laps of six, 26 ms median), which says how strong the sheet is; the sector crossings were
 * all lost, which says the picture must be quiet before any of it is worth reading.
 *
 * So the coarse picture is calibrated on itself, the way every line already is: twice its own
 * noise floor, taken from the quietest clip. A busy clip is not evidence about noise — that is
 * the `calibrateFromClips` finding, and it holds here for the same reason.
 */
export function calibrateCoarse(clips: ReadonlyArray<ReadonlyArray<FrameCrop>>): number {
  const quiets: number[] = [];
  for (const clip of clips) {
    const diffs = coarseFrameDiffs(clip);
    if (diffs.length < 2) continue;
    const s = [...diffs].sort((a, b) => a - b);
    quiets.push(s[Math.min(s.length - 1, Math.floor(s.length * 0.05))]!);
  }
  if (!quiets.length) return MIN_COARSE_THRESH;
  return Math.max(MIN_COARSE_THRESH, Math.min(...quiets) * NOISE_MULTIPLE);
}

/**
 * Brightness of an RGBA picture, one byte a pixel.
 *
 * Separate from the blur rather than fused into it: the blur reads every pixel three times, so
 * computing brightness inside it would do the colour arithmetic three times over.
 */
export function lumaOf(rgba: FrameCrop, out: Uint8Array): FrameCrop {
  const n = rgba.width * rgba.height;
  const d = rgba.data;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    out[p] = (d[i]! * LUMA_R + d[i + 1]! * LUMA_G + d[i + 2]! * LUMA_B + 0.5) | 0;
  }
  return { width: rgba.width, height: rgba.height, channels: 1, data: out };
}

/**
 * A 3-tap Gaussian over one channel of a whole picture.
 *
 * The same numbers `gaussianBlur3` produces — [1 2 1] horizontally then vertically, accumulated
 * as integers and rounded once at the end — without the per-pixel channel loop, the span lookups
 * or the `reflect101` call, none of which vary when the picture is one channel and the region is
 * all of it. The edges reflect the same way (index −1 reads 1, index `len` reads `len−2`), so a
 * blurred frame from here and one from there differ nowhere.
 */
export function blurLuma(src: FrameCrop, horiz: Int32Array, out: Uint8Array): FrameCrop {
  const { width: w, height: h, data } = src;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // Reflected at both ends: x−1 at x=0 is x=1, x+1 at x=w−1 is x=w−2.
    horiz[row] = data[row + (w > 1 ? 1 : 0)]! + 2 * data[row]! + data[row + (w > 1 ? 1 : 0)]!;
    for (let x = 1; x < w - 1; x++) {
      horiz[row + x] = data[row + x - 1]! + 2 * data[row + x]! + data[row + x + 1]!;
    }
    if (w > 1) {
      const x = w - 1;
      horiz[row + x] = data[row + x - 1]! + 2 * data[row + x]! + data[row + x - 1]!;
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = (y > 0 ? y - 1 : Math.min(1, h - 1)) * w;
    const down = (y < h - 1 ? y + 1 : Math.max(0, h - 2)) * w;
    for (let x = 0; x < w; x++) {
      const sum = horiz[up + x]! + 2 * horiz[row + x]! + horiz[down + x]!;
      out[row + x] = (sum + BLUR3_ROUND) / (BLUR3_SUM * BLUR3_SUM);
    }
  }
  return { width: w, height: h, channels: 1, data: out };
}

/** What one pass of the mask found: how much moved, and which rows hold any of it. */
export type MaskResult = {
  /** Pixels set, so the caller can ask whether the camera moved rather than the cars. */
  moved: number;
  /** Rows the mask occupies, `[x0, x1)` per row — empty rows are `x0 === x1 === 0`. */
  spans: RowSpans;
};

/**
 * Everything that moved, by the two-ways rule, over a whole one-channel picture.
 *
 * A pixel counts when it **changed** since the frame before — the old rule, untouched — **or**
 * when it both differs from the still picture of the empty track and changed at least half as
 * much as the gate asks. Never the still picture alone: grain differs from it too, and a rule
 * that believes the picture on its own finds a median of 181 blobs where the two-ways rule finds
 * two (measured 2026-09-07). With no frame before it, a pixel has to clear twice the gate.
 *
 * The row spans are built in the same pass rather than by walking the mask again afterwards,
 * which is what makes confining the dilation to them free.
 */
export function coarseMask(
  cur: FrameCrop,
  prev: FrameCrop | null,
  bg: FrameCrop | null,
  thresh: number,
  mask: Uint8Array,
  spans: RowSpans,
  /** Only these rows and columns are looked at — the track (`trackBounds`), or the whole picture. */
  bounds?: RowSpans
): MaskResult {
  const { width: w, height: h, data } = cur;
  const p = prev?.data ?? null;
  const b = bg?.data ?? null;
  const bgAlone = thresh * BG_ALONE_MULTIPLE;
  mask.fill(0, 0, w * h);
  let moved = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let lo = -1;
    let hi = -1;
    const from = bounds ? bounds.x0[y]! : 0;
    const to = bounds ? bounds.x1[y]! : w;
    for (let x = from; x < to; x++) {
      const i = row + x;
      const c = data[i]!;
      let set = false;
      if (p) {
        const d = c - p[i]!;
        const changed = d < 0 ? -d : d;
        if (changed > thresh) set = true;
        else if (b) {
          const o = c - b[i]!;
          const off = o < 0 ? -o : o;
          set = off > thresh && changed * 2 > thresh;
        }
      } else if (b) {
        const o = c - b[i]!;
        set = (o < 0 ? -o : o) > bgAlone;
      }
      if (set) {
        mask[i] = 1;
        moved++;
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    if (lo < 0) {
      spans.x0[y] = 0;
      spans.x1[y] = 0;
    } else {
      spans.x0[y] = lo;
      spans.x1[y] = hi + 1;
    }
  }
  return { moved, spans };
}

/**
 * `expandSpans`, writing into buffers that already exist.
 *
 * The spans are rebuilt every frame and a race is tens of thousands of them, so the library
 * version's two fresh `Int32Array`s a call would be three allocations a frame for nothing. Same
 * answer: each row's range grows by `margin` sideways and takes in every row within `margin`.
 */
function expandSpansInto(src: RowSpans, margin: number, out: RowSpans): RowSpans {
  const { h, w } = src;
  for (let y = 0; y < h; y++) {
    let lo = Number.MAX_SAFE_INTEGER;
    let hi = -1;
    const from = Math.max(0, y - margin);
    const to = Math.min(h - 1, y + margin);
    for (let yy = from; yy <= to; yy++) {
      if (src.x1[yy]! <= src.x0[yy]!) continue;
      if (src.x0[yy]! < lo) lo = src.x0[yy]!;
      if (src.x1[yy]! > hi) hi = src.x1[yy]!;
    }
    if (hi < 0) {
      out.x0[y] = 0;
      out.x1[y] = 0;
    } else {
      out.x0[y] = Math.max(0, lo - margin);
      out.x1[y] = Math.min(w, hi + margin);
    }
  }
  return out;
}

/** Every row of a picture, so a caller that wants no bounds can say so. */
export function wholePicture(w: number, h: number): RowSpans {
  const x0 = new Int32Array(h);
  const x1 = new Int32Array(h).fill(w);
  return { h, w, x0, x1 };
}

/** Convex hull, Andrew's monotone chain, anticlockwise. */
function convexHull(pts: ReadonlyArray<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Array<{ x: number; y: number }> = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Array<{ x: number; y: number }> = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Where the track is, taken from where the driver drew the lines across it.
 *
 * **This is the difference between a pass that works and one that drowns.** A whole 4K frame is
 * not mostly track: it is trees, a drivers' stand, a fence, spectators, flags and a car park, and
 * all of them move. Measured on real footage 2026-09-08, searching the whole picture produced over
 * twenty-four moving things a frame on a third of the frames, **7 865 paths for four cars**, and
 * every path was shredded by things merging into things. Neither a gentler gate nor a stricter one
 * helps, because that movement is real movement — it is simply not a car.
 *
 * A driver has already said where the track is, by drawing a line across it at every corner. The
 * hull of those lines' ends is the track, and a margin either side covers the racing line bulging
 * wide between them. Nothing outside is looked at, which removes the trees, makes the difference
 * cheaper in proportion, and leaves the strip detector reading only when a car is genuinely near
 * a line.
 *
 * The risk is a layout whose lines do not span it — three lines on one side of a big track. A car
 * outside the hull leaves a hole in its path rather than a wrong answer, and the coverage figure
 * on the trace says so. `share` is returned for exactly that reason: a hull covering almost
 * nothing is a sign the lines are too few, not that the track is small.
 */
export function trackBounds(
  lines: ReadonlyArray<SectorLine>,
  frameW: number,
  frameH: number,
  divisor: number,
  marginPx: number
): { spans: RowSpans; share: number } {
  const w = Math.max(2, Math.round(frameW / divisor));
  const h = Math.max(2, Math.round(frameH / divisor));
  const pts: Array<{ x: number; y: number }> = [];
  for (const l of lines) {
    pts.push({ x: (l.x1 * frameW) / divisor, y: (l.y1 * frameH) / divisor });
    pts.push({ x: (l.x2 * frameW) / divisor, y: (l.y2 * frameH) / divisor });
  }
  if (pts.length < 3) return { spans: wholePicture(w, h), share: 1 };
  const hull = convexHull(pts);
  if (hull.length < 3) return { spans: wholePicture(w, h), share: 1 };

  const raw: RowSpans = { h, w, x0: new Int32Array(h), x1: new Int32Array(h) };
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]!;
      const b = hull[(i + 1) % hull.length]!;
      if (a.y === b.y) continue;
      const t = (yc - a.y) / (b.y - a.y);
      if (t < 0 || t > 1) continue;
      const x = a.x + (b.x - a.x) * t;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (hi < lo) {
      raw.x0[y] = 0;
      raw.x1[y] = 0;
    } else {
      raw.x0[y] = Math.max(0, Math.floor(lo));
      raw.x1[y] = Math.min(w, Math.ceil(hi) + 1);
    }
  }
  const margin = Math.max(0, Math.round(marginPx));
  const spans: RowSpans = { h, w, x0: new Int32Array(h), x1: new Int32Array(h) };
  expandSpansInto(raw, margin, spans);
  let area = 0;
  for (let y = 0; y < h; y++) area += Math.max(0, spans.x1[y]! - spans.x0[y]!);
  return { spans, share: area / (w * h) };
}

/** One frame's worth of what the coarse picture held, plus why it may hold nothing. */
export type CoarseFrame = ObsFrame & {
  /** Share of the picture that differed — the camera test. */
  movedShare: number;
  /** The whole picture moved: this is the camera, not the cars, and nothing here is a sighting. */
  shake: boolean;
  /** More moving things than the cap, so the smallest were left out. */
  crowded: boolean;
};

export type CoarseParams = {
  /** Coarse picture size. */
  w: number;
  h: number;
  /** How many frame pixels one coarse pixel covers, so positions come back in frame pixels. */
  divisor: number;
  /** Brightness difference above which a pixel moved. Calibrated per line, gentlest wins. */
  thresh: number;
  /** The car's apparent length in coarse pixels, for the blob floor. */
  carPx: number;
  /**
   * Where the track is, so nothing outside it is ever looked at. Absent means the whole picture,
   * which is what the tests and the timing rig use.
   */
  bounds?: RowSpans;
};

/**
 * Frames in, moving things out — with every buffer allocated once.
 *
 * A race is tens of thousands of frames, and every array here is hundreds of kilobytes; allocating
 * per frame is what turns a working pass into an unusable one. The same discipline as `LineCrop`
 * in `browserScan.ts` and `LapTracer` in the tracer.
 */
export class CoarseDetector {
  private readonly luma: Uint8Array;
  private readonly blurA: Uint8Array;
  private readonly blurB: Uint8Array;
  private readonly horiz: Int32Array;
  private readonly mask: Uint8Array;
  private readonly support: Uint8Array;
  private readonly spans: RowSpans;
  /** The mask's rows grown by each dilation pass's reach, rebuilt in place every frame. */
  private readonly spans2: RowSpans;
  private readonly spans4: RowSpans;
  private readonly dil: { a: Uint8Array; b: Uint8Array; horiz: Uint8Array };
  private readonly seen: Uint8Array;
  private readonly stack: Int32Array;
  private readonly minArea: number;
  /** The empty track, one channel, blurred the same way every frame is. */
  private background: FrameCrop | null = null;
  /** The frame before, blurred. Null until one has been pushed. */
  private prev: FrameCrop | null = null;
  /** Which of the two blur buffers the next frame writes to. */
  private useA = true;

  /** Frames whose picture moved as a whole. */
  shakeFrames = 0;
  /** Frames that held more moving things than the cap. */
  crowdedFrames = 0;
  /**
   * Pixels actually looked at — the track, not the picture.
   *
   * The camera test is a share of what is searched: with the search confined to the track, the
   * same nudge lights up the same fraction of it, so the test means the same thing whether the
   * track fills the frame or a corner of it.
   */
  private readonly searchArea: number;

  constructor(readonly p: CoarseParams) {
    const px = p.w * p.h;
    this.luma = new Uint8Array(px);
    this.blurA = new Uint8Array(px);
    this.blurB = new Uint8Array(px);
    this.horiz = new Int32Array(px);
    this.mask = new Uint8Array(px);
    this.support = new Uint8Array(px);
    this.spans = { h: p.h, w: p.w, x0: new Int32Array(p.h), x1: new Int32Array(p.h) };
    this.spans2 = { h: p.h, w: p.w, x0: new Int32Array(p.h), x1: new Int32Array(p.h) };
    this.spans4 = { h: p.h, w: p.w, x0: new Int32Array(p.h), x1: new Int32Array(p.h) };
    this.dil = { a: new Uint8Array(px), b: new Uint8Array(px), horiz: new Uint8Array(px) };
    this.seen = new Uint8Array(px);
    this.stack = new Int32Array(px);
    this.minArea = minAreaForCoarseCar(p.carPx);
    let area = 0;
    if (p.bounds) {
      for (let y = 0; y < p.h; y++) area += Math.max(0, p.bounds.x1[y]! - p.bounds.x0[y]!);
    } else {
      area = px;
    }
    this.searchArea = Math.max(1, area);
  }

  /**
   * The still picture of the empty track, given as RGBA at the coarse size. Blurred and kept as
   * brightness, so it is compared against frames that went through exactly the same arithmetic.
   */
  setBackground(rgba: FrameCrop): void {
    const luma = lumaOf(rgba, new Uint8Array(this.p.w * this.p.h));
    const out = new Uint8Array(this.p.w * this.p.h);
    this.background = blurLuma(luma, this.horiz, out);
  }

  get hasBackground(): boolean {
    return this.background != null;
  }

  /** Throw away the frame-to-frame reference — after a seek, or a rebuilt still picture. */
  forgetPrevious(): void {
    this.prev = null;
  }

  /**
   * One coarse RGBA frame → everything that moved in it, positioned in FULL-FRAME pixels so the
   * chain, the linker and the trace all speak the same coordinates as the drawn lines do.
   */
  push(rgba: FrameCrop, t: number): CoarseFrame {
    const { w, h, divisor } = this.p;
    const luma = lumaOf(rgba, this.luma);
    const out = this.useA ? this.blurA : this.blurB;
    this.useA = !this.useA;
    const blurred = blurLuma(luma, this.horiz, out);

    const { moved } = coarseMask(blurred, this.prev, this.background, this.p.thresh, this.mask, this.spans, this.p.bounds);
    this.prev = blurred;
    const movedShare = moved / this.searchArea;

    if (movedShare > SHAKE_SHARE) {
      // The camera, not the cars. The frame still becomes the reference for the next one — the
      // picture has genuinely moved, and comparing the one after it against a stale frame would
      // report the move twice.
      this.shakeFrames++;
      return { t, blobs: [], movedShare, shake: true, crowded: false };
    }
    if (moved === 0) return { t, blobs: [], movedShare, shake: false, crowded: false };

    this.support.set(this.mask);
    // Each pass of the 5-tap dilation reaches two pixels, so pass one works over the mask's own
    // rows grown by two and pass two over the same grown by four. Confining it there is what took
    // the spread from 12.7 ms a frame to 0.2 ms without changing a single blob.
    expandSpansInto(this.spans, 2, this.spans2);
    expandSpansInto(this.spans, 4, this.spans4);
    const grown = dilate5(this.mask, w, h, [this.spans2, this.spans4], this.dil);
    const blobs = findBlobs(grown, w, h, this.minArea, this.spans4, this.seen, this.stack, this.support);

    const crowded = blobs.length > MAX_BLOBS_PER_FRAME;
    if (crowded) this.crowdedFrames++;
    const kept = crowded ? [...blobs].sort((a, b) => b.area - a.area).slice(0, MAX_BLOBS_PER_FRAME) : blobs;

    const obs: Obs[] = kept.map((b) => ({
      t,
      x: b.cx * divisor,
      y: b.cy * divisor,
      w: (b.box.x1 - b.box.x0 + 1) * divisor,
      h: (b.box.y1 - b.box.y0 + 1) * divisor,
      area: b.area * divisor * divisor,
    }));
    return { t, blobs: obs, movedShare, shake: false, crowded };
  }
}
