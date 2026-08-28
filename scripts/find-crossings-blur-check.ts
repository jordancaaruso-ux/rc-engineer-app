/**
 * Verify the ported blur against an independent implementation.
 *
 * Everything else about the port has been checked against the original's own metadata and
 * matches. The blur has only ever been checked by reading it, and it is the one primitive whose
 * failure would produce exactly the symptom seen: no effect on bands over smooth tarmac (where
 * there is nothing to smooth), and a flood of false motion on bands over painted markings.
 *
 * Reference is sharp's convolve with the same 5x5 binomial kernel OpenCV uses for
 * GaussianBlur(src, (5,5), 0) — a separate codebase, so a shared mistake is unlikely.
 * Borders are excluded: the two use different edge conventions and that is not what is in doubt.
 */

import sharp from "sharp";

import { gaussianBlur5 } from "../src/lib/videoAnalysis/findCrossings/imageOps";
import { spansFromMask } from "../src/lib/videoAnalysis/findCrossings/spans";

const W = 96;
const H = 96;

async function main() {
  // Deterministic pseudo-random texture with hard edges, which is where blurs differ most.
  const src = new Uint8Array(W * H * 3);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const stripe = (x + y) % 7 < 3 ? 235 : 20;
      for (let c = 0; c < 3; c++) {
        const i = (y * W + x) * 3 + c;
        src[i] = Math.max(0, Math.min(255, Math.round(stripe + (rand() - 0.5) * 40)));
      }
    }
  }

  const all = new Uint8Array(W * H).fill(1);
  const spans = spansFromMask(all, W, H);
  const mine = gaussianBlur5(
    { width: W, height: H, channels: 3, data: src },
    spans,
    spans,
    { horiz: new Int32Array(W * H * 3), out: new Uint8Array(W * H * 3) }
  );

  // 5x5 separable binomial as a full kernel: outer product of [1,4,6,4,1], scaled by 256.
  const row = [1, 4, 6, 4, 1];
  const kernel: number[] = [];
  for (const a of row) for (const b of row) kernel.push(a * b);
  const ref = await sharp(Buffer.from(src), { raw: { width: W, height: H, channels: 3 } })
    .convolve({ width: 5, height: 5, kernel, scale: 256, offset: 0 })
    .raw()
    .toBuffer();

  let maxDiff = 0;
  let sumDiff = 0;
  let n = 0;
  let over1 = 0;
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      for (let c = 0; c < 3; c++) {
        const i = (y * W + x) * 3 + c;
        const d = Math.abs(mine.data[i] - ref[i]);
        if (d > maxDiff) maxDiff = d;
        if (d > 1) over1++;
        sumDiff += d;
        n++;
      }
    }
  }

  console.log(
    `blur check over ${n} interior samples:\n` +
      `  max difference ${maxDiff}\n` +
      `  mean difference ${(sumDiff / n).toFixed(3)}\n` +
      `  samples differing by more than 1: ${over1}`
  );
  console.log(
    maxDiff <= 1
      ? "\nPASS — the ported blur matches the reference."
      : "\nFAIL — the ported blur does NOT match; this would explain false motion on textured bands."
  );

  // Also state plainly how much the blur is actually reducing high-frequency detail, since a
  // blur that runs but does nothing would pass a same-vs-same comparison and still be wrong.
  let rawVar = 0;
  let blurVar = 0;
  for (let y = 3; y < H - 3; y++) {
    for (let x = 4; x < W - 3; x++) {
      const i = (y * W + x) * 3;
      const j = (y * W + x - 1) * 3;
      rawVar += Math.abs(src[i] - src[j]);
      blurVar += Math.abs(mine.data[i] - mine.data[j]);
    }
  }
  console.log(
    `\nneighbour-to-neighbour variation: raw ${(rawVar / n).toFixed(1)} -> blurred ${(blurVar / n).toFixed(1)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
