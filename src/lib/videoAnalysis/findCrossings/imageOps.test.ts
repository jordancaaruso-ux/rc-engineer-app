/**
 * The blur is chosen per line, and each kernel does what its name says. Bendigo S1 (2026-09-02):
 * a 9px line, a car four pixels across, and a 5-tap blur that took a 20-level pass down to 8.
 */
import { blurFrame, findBlobs, motionMaskInBandBg } from "./imageOps";
import { blurKernelFor, BLUR_FULL_MIN_LINE_PX, BLUR_LIGHT_MIN_LINE_PX } from "./geometry";
import { spansFromMask } from "./spans";
import type { FrameCrop } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const geom = (norm: number) => ({ p1x: 0, p1y: 0, dx: norm, dy: 0, norm });

/* ---------- which kernel a line gets ---------- */
{
  const far = { blur: 5, blurByLine: true };
  assert(blurKernelFor(geom(9), far) === 1, "a 9px line is read unblurred");
  assert(blurKernelFor(geom(BLUR_LIGHT_MIN_LINE_PX), far) === 3, "a short line gets the 3-tap");
  assert(blurKernelFor(geom(30), far) === 3, "30px: 3-tap");
  assert(blurKernelFor(geom(BLUR_FULL_MIN_LINE_PX), far) === 5, "40px and up: the full blur");
  assert(blurKernelFor(geom(188), far) === 5, "a long line keeps the validated blur");
  assert(blurKernelFor(geom(9), { blur: 5 }) === 5, "without blurByLine the recipe's kernel is used everywhere");
  assert(blurKernelFor(geom(30), { blur: 3, blurByLine: true }) === 3, "the recipe's kernel is a ceiling");
}

/* ---------- an impulse through each kernel ---------- */
{
  const w = 9, h = 9;
  const mask = new Uint8Array(w * h).fill(1);
  const spans = spansFromMask(mask, w, h);
  const src: FrameCrop = { width: w, height: h, channels: 1, data: new Uint8Array(w * h) };
  src.data[4 * w + 4] = 255;
  const scratch = { horiz: new Int32Array(w * h), out: new Uint8Array(w * h) };

  const k1 = blurFrame(src, 1, spans, spans, scratch);
  assert(k1.data[4 * w + 4] === 255 && k1.data[4 * w + 5] === 0, "kernel 1 passes pixels through");
  assert(k1.data !== src.data, "…into the scratch buffer, not aliased");

  const k3 = blurFrame(src, 3, spans, spans, { horiz: new Int32Array(w * h), out: new Uint8Array(w * h) });
  // [1,2,1]/4 in each direction: centre 4/16, edge-neighbour 2/16, corner 1/16.
  assert(k3.data[4 * w + 4] === 64, `3-tap centre 255*4/16 → 64, got ${k3.data[4 * w + 4]}`);
  assert(k3.data[4 * w + 5] === 32, `3-tap neighbour 255*2/16 → 32, got ${k3.data[4 * w + 5]}`);
  assert(k3.data[4 * w + 6] === 0, "3-tap reaches one pixel");

  const k5 = blurFrame(src, 5, spans, spans, { horiz: new Int32Array(w * h), out: new Uint8Array(w * h) });
  // [1,4,6,4,1]/16: centre 36/256.
  assert(k5.data[4 * w + 4] === 36, `5-tap centre 255*36/256 → 36, got ${k5.data[4 * w + 4]}`);
  assert(k5.data[4 * w + 6] === 6, `5-tap two out 255*6/256 → 6, got ${k5.data[4 * w + 6]}`);
  assert(k5.data[4 * w + 7] === 0, "5-tap reaches two pixels");
}

/* ---------- a slow faint car: invisible frame to frame, plain against the background ---------- */
{
  const w = 20, h = 5;
  const band = new Uint8Array(w * h).fill(1);
  const spans = spansFromMask(band, w, h);
  const track = 150;
  const bg = new Float32Array(w * h * 3).fill(track);
  // A four-pixel car 12 levels darker than the track, moving one pixel a frame: the change
  // between frames is 12 on one pixel each side, the difference from the empty track is 12 on
  // all four.
  const frameAt = (x0: number): FrameCrop => {
    const data = new Uint8Array(w * h * 3).fill(track);
    for (let y = 0; y < h; y++) for (let x = x0; x < x0 + 4; x++) for (let c = 0; c < 3; c++) data[(y * w + x) * 3 + c] = track - 12;
    return { width: w, height: h, channels: 3, data };
  };
  const a = frameAt(5);
  const b = frameAt(6);
  const out = new Uint8Array(w * h);

  const count = (want: 1 | 2 | 3 | null) => { let n = 0; for (const v of out) if (v && (want == null || v === want)) n++; return n; };

  motionMaskInBandBg(a, b, 14, null, 14, band, spans, out);
  assert(count(null) === 0, `frame to frame at a gate of 14, the car is invisible (got ${count(null)} px)`);

  motionMaskInBandBg(a, b, 14, bg, 8, band, spans, out);
  assert(count(null) === 4 * h, `against the empty track every car pixel counts (got ${count(null)}, want ${4 * h})`);
  // The column it entered changed by 12 — under the gate of 14, over half of it: a weak change
  // (3). The three columns it was already covering did not change at all (2).
  assert(count(3) === 1 * h && count(2) === 3 * h, `weak change on the entered column, none on the rest (got 3s ${count(3)}, 2s ${count(2)})`);

  motionMaskInBandBg(a, b, 8, bg, 8, band, spans, out);
  // Frame to frame sees the column it left and the column it entered; the background sees the
  // car. Together: the car plus the column behind it, each pixel counted once — and the two
  // changed columns are marked as such, so the background may not learn from them.
  assert(count(null) === 5 * h, `both tests together: the car and the column it just left (got ${count(null)}, want ${5 * h})`);
  assert(count(1) === 2 * h, `the columns that changed carry the frame-to-frame mark (got ${count(1)}, want ${2 * h})`);
}

/* ---------- a patch that merely differs from the background is not a blob ---------- */
{
  const w = 30, h = 12;
  const mask = new Uint8Array(w * h);
  const support = new Uint8Array(w * h);
  // Two 6x6 squares in the dilated mask. The left one has one pixel that changed this frame;
  // the right one only differs from the background.
  for (let y = 3; y < 9; y++) for (let x = 2; x < 8; x++) { mask[y * w + x] = 1; support[y * w + x] = 2; }
  for (let y = 3; y < 9; y++) for (let x = 18; x < 24; x++) { mask[y * w + x] = 1; support[y * w + x] = 2; }
  support[5 * w + 4] = 3;
  const all = new Uint8Array(w * h).fill(1);
  const spans = spansFromMask(all, w, h);
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  const without = findBlobs(mask, w, h, 4, spans, seen, stack);
  assert(without.length === 2, `no support mask: both squares are blobs (got ${without.length})`);
  const withSupport = findBlobs(mask, w, h, 4, spans, seen, stack, support);
  assert(withSupport.length === 1, `with support: only the square that moved is a blob (got ${withSupport.length})`);
  assert(withSupport[0]!.cx < 15, "and it is the left one");
}

console.log("findCrossings imageOps.test.ts OK");
