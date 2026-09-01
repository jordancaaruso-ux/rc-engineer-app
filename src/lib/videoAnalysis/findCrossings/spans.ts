/**
 * Per-row column ranges covering the band, so every pixel pass can skip the rest of the crop.
 *
 * This is an optimisation with no effect on the result: the motion mask is ANDed with the band
 * before anything else looks at it, so pixels outside the band contribute nothing. The only
 * care needed is at the edges — dilation grows blobs a few pixels PAST the band, and the blur
 * reads a couple of pixels either side of every pixel it writes, so each pass gets the margin
 * it actually needs rather than a single shared guess.
 *
 * On a diagonal start/finish line this cuts the work by roughly eight times, which is the
 * difference between a validation run finishing and not.
 */

/** Half-open column range per row: `[x0, x1)`. An empty row has `x0 === x1`. */
export type RowSpans = { h: number; w: number; x0: Int32Array; x1: Int32Array };

export function spansFromMask(mask: Uint8Array, w: number, h: number): RowSpans {
  const x0 = new Int32Array(h);
  const x1 = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      if (mask[off + x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    if (lo < 0) {
      x0[y] = 0;
      x1[y] = 0;
    } else {
      x0[y] = lo;
      x1[y] = hi + 1;
    }
  }
  return { h, w, x0, x1 };
}

/**
 * Grow spans by `margin` pixels in every direction — horizontally within each row, and
 * vertically by unioning the rows within reach.
 */
export function expandSpans(spans: RowSpans, margin: number): RowSpans {
  const { h, w } = spans;
  const x0 = new Int32Array(h);
  const x1 = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    let lo = Number.MAX_SAFE_INTEGER;
    let hi = -1;
    const from = Math.max(0, y - margin);
    const to = Math.min(h - 1, y + margin);
    for (let yy = from; yy <= to; yy++) {
      if (spans.x1[yy] <= spans.x0[yy]) continue;
      if (spans.x0[yy] < lo) lo = spans.x0[yy];
      if (spans.x1[yy] > hi) hi = spans.x1[yy];
    }
    if (hi < 0) {
      x0[y] = 0;
      x1[y] = 0;
    } else {
      x0[y] = Math.max(0, lo - margin);
      x1[y] = Math.min(w, hi + margin);
    }
  }
  return { h, w, x0, x1 };
}

/** Total pixels covered — used to report how much work a window actually costs. */
export function spanArea(spans: RowSpans): number {
  let n = 0;
  for (let y = 0; y < spans.h; y++) n += Math.max(0, spans.x1[y] - spans.x0[y]);
  return n;
}
