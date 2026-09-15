/**
 * Where to look for the car, and how big a look.
 *
 * The lap tracer never reads a whole frame — a 4K readback is the cost that made a full-frame
 * detector impossible in the browser (measured 93.8ms a frame, `browserScan.ts`). It reads a
 * square around where the car should be, a few car lengths across, and moves it every frame.
 *
 * The car's size on screen sets everything: the window, the blur, the smallest blob worth
 * keeping, how far a step may be. It is not known, so it is taken from the sector lines — a line
 * is drawn across the track, and a touring car is about a tenth of a track's width — and
 * interpolated between the two lines that bound the stretch being read.
 */

import type { LineGeom } from "../findCrossings/geometry";
import type { BlurKernel } from "../findCrossings/imageOps";
import type { RowSpans } from "../findCrossings/spans";
import type { Roi } from "../findCrossings/types";

/** A car's length as a fraction of a sector line's length — a line spans the track. */
export const CAR_FRACTION_OF_LINE = 0.1;
/** No car is read smaller than this, whatever the lines say: below it there is nothing to blob. */
export const MIN_CAR_PX = 6;

/** Car lengths across the window while the car is being followed, and while it is lost. */
export const WINDOW_CAR_LENGTHS = 6;
export const LOST_WINDOW_CAR_LENGTHS = 16;
/** The window never goes under this many pixels, nor over this fraction of the frame width. */
export const MIN_WINDOW_PX = 48;
export const MAX_WINDOW_FRAC = 0.12;
export const MAX_LOST_WINDOW_FRAC = 0.5;

/**
 * The car's apparent length, in frame pixels, between two lines. `frac` is how far from `a`
 * towards `b` (0..1); a missing line falls back to the other one.
 */
export function carPxBetween(a: LineGeom | null, b: LineGeom | null, frac: number): number {
  const la = a ? a.norm * CAR_FRACTION_OF_LINE : null;
  const lb = b ? b.norm * CAR_FRACTION_OF_LINE : null;
  const f = Math.max(0, Math.min(1, frac));
  const px = la != null && lb != null ? la + (lb - la) * f : (la ?? lb ?? MIN_CAR_PX);
  return Math.max(MIN_CAR_PX, px);
}

/** How wide the window is, in pixels, for a car this big. */
export function windowSide(carPx: number, frameW: number, lost: boolean): number {
  const lengths = lost ? LOST_WINDOW_CAR_LENGTHS : WINDOW_CAR_LENGTHS;
  const cap = frameW * (lost ? MAX_LOST_WINDOW_FRAC : MAX_WINDOW_FRAC);
  return Math.round(Math.max(MIN_WINDOW_PX, Math.min(cap, carPx * lengths)));
}

/** A square window centred on a point, clamped inside the frame. Integer edges, half-open. */
export function windowFor(cx: number, cy: number, side: number, frameW: number, frameH: number): Roi {
  const s = Math.max(8, Math.min(side, frameW, frameH));
  let x0 = Math.round(cx - s / 2);
  let y0 = Math.round(cy - s / 2);
  x0 = Math.max(0, Math.min(frameW - s, x0));
  y0 = Math.max(0, Math.min(frameH - s, y0));
  return { x0, y0, x1: x0 + s, y1: y0 + s };
}

/**
 * The blur for a car this size. Same thresholds as a sector line gets (`blurKernelFor`), read
 * off the car rather than the line: a four-pixel car under the 5-tap is mostly gone.
 */
export function blurKernelForCar(carPx: number): BlurKernel {
  if (carPx >= 4 * MIN_CAR_PX) return 5;
  if (carPx >= 2 * MIN_CAR_PX) return 3;
  return 1;
}

/**
 * The moving mask is spread TWICE before its pieces are counted as one thing, whatever size the
 * car is. Each pass reaches two pixels, so two passes reach four, which looked far too much at
 * the far end of a fisheye where the car is seventeen pixels long — a quarter of the car, and
 * enough to weld grain eight pixels apart into slabs.
 *
 * Dropping to one pass there was tried on 2026-09-07 and was much worse: the drawn line fell from
 * 72 % of the lap to 51 %, the readings lost at the sector lines went 6 to 29 %, and one lap lost
 * a fifth of a sector it had been following cleanly. Spreading is what joins the pieces of one
 * car back together — a small car's mask breaks up more, not less — and the slabs of grain it
 * also makes are the chain's problem to price, which it does.
 */

/** The smallest blob that can be a car this size. Scaled from the recipe's floor at a 20px car. */
export function minAreaForCar(carPx: number, recipeMinArea: number): number {
  return Math.max(4, recipeMinArea * (carPx / 20) ** 2);
}

/** Row spans covering a whole crop — the window has no band, every pixel counts. */
export function fullSpans(w: number, h: number): RowSpans {
  const x0 = new Int32Array(h);
  const x1 = new Int32Array(h).fill(w);
  return { h, w, x0, x1 };
}
