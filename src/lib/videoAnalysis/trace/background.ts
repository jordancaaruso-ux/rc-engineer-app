/**
 * A still picture of the track with the cars taken out.
 *
 * Differencing one frame against the one before it only ever shows the sliver a thing moved into:
 * about its width times how far it went. At the far end of a track that is a few dozen pixels of
 * a car that is really several hundred, and when the car is quick it is worse in the other
 * direction — the window itself jumps, and two crops cut from different places only share part of
 * their ground, so a chunk of the picture cannot be compared at all.
 *
 * Against a still picture of the empty track neither happens. The car shows up whole, in the right
 * place, every frame, however fast or slow it is going, and the whole window is usable. It works
 * because the camera does not move: measured over all four graded clips on 2026-09-07, the picture
 * shifts by 0.00–0.01 px from one frame to the next, and creeps at most half a pixel over five
 * minutes on the 1080p footage (10 px over twelve minutes on the 4K, which is under half a pixel
 * across any one lap). A phone on a tripod at the drivers' stand is what this product is for.
 *
 * The picture is the per-pixel median of a handful of frames spread across the lap. A car sits on
 * any given pixel in at most one or two of them, so the middle value is the track. Median, not
 * mean: an average keeps a ghost of every car that passed.
 */

import type { FrameCrop, Roi } from "../findCrossings/types";

/**
 * How many frames the still picture is built from. Odd, so the middle value is a real reading and
 * not an average of two. Five spread over a lap puts them seconds apart, which is far more than
 * any car needs to leave a pixel.
 */
export const BACKGROUND_FRAMES = 5;

/** The fewest that will still do: with three, a pixel needs two cars on it to be fooled. */
export const MIN_BACKGROUND_FRAMES = 3;

/**
 * The per-pixel, per-channel middle value of the frames given. They must all be the same size and
 * have the same channel count; the result is a frame of the same shape.
 */
export function medianBackground(frames: FrameCrop[]): FrameCrop | null {
  if (frames.length < MIN_BACKGROUND_FRAMES) return null;
  const { width, height, channels } = frames[0]!;
  for (const f of frames) {
    if (f.width !== width || f.height !== height || f.channels !== channels) return null;
  }
  const n = frames.length;
  const mid = n >> 1;
  const data = new Uint8Array(width * height * channels);
  const vals = new Uint8Array(n);
  const datas = frames.map((f) => f.data);
  for (let i = 0; i < data.length; i++) {
    for (let k = 0; k < n; k++) vals[k] = datas[k]![i]!;
    // Insertion sort: n is five, and this runs once per channel of every pixel.
    for (let a = 1; a < n; a++) {
      const v = vals[a]!;
      let b = a - 1;
      while (b >= 0 && vals[b]! > v) {
        vals[b + 1] = vals[b]!;
        b--;
      }
      vals[b + 1] = v;
    }
    data[i] = vals[mid]!;
  }
  return { width, height, channels, data };
}

/**
 * The part of the still picture under `roi`, copied into `out` as a crop of its own — the shape
 * the blur and the difference want. Anything outside the picture is left as it was, which the
 * ROI never is: windows are clamped to the frame.
 */
export function patchInto(bg: FrameCrop, roi: Roi, out: Uint8Array): FrameCrop {
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const c = bg.channels;
  for (let y = 0; y < h; y++) {
    const from = ((roi.y0 + y) * bg.width + roi.x0) * c;
    out.set(bg.data.subarray(from, from + w * c), y * w * c);
  }
  return { width: w, height: h, channels: c, data: out };
}
