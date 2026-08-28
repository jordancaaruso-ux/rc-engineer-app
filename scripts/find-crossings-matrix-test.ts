/**
 * How noisy is the band, and does the YUV->RGB matrix explain it?
 *
 * The source is 10-bit HLG BT.2020. ffmpeg honours that tag; OpenCV's capture path historically
 * did not, converting with BT.601 coefficients regardless. BT.2020 puts more weight on the chroma
 * planes, and chroma is stored at half resolution — so on flat grey tarmac the two choices can
 * differ a lot in how much per-frame chroma wobble survives into an RGB difference.
 *
 * Prints the distribution of inter-frame differences inside one line's band for each matrix.
 * If BT.601 is markedly quieter, that is the discrepancy with the 2026-07 probe.
 *
 * Usage: npx tsx scripts/find-crossings-matrix-test.ts <lineKey> <atSec>
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { bandMask, roiFor } from "../src/lib/videoAnalysis/findCrossings/geometry";
import { RECIPE_B22_T14, type SectorLine } from "../src/lib/videoAnalysis/findCrossings/types";

const PROBE = "C:/Users/Jordan/Documents/rc-autosnap-results/autosnap-me/probe-data.json";
const W = 3840;
const H = 2160;

function decodeFrames(
  videoPath: string,
  filter: string,
  w: number,
  h: number,
  startSec: number,
  count: number
): Promise<Buffer[]> {
  const bytes = w * h * 3;
  return new Promise((resolve) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", startSec.toFixed(6),
        "-i", videoPath,
        "-frames:v", String(count),
        "-fps_mode", "passthrough",
        "-vf", filter,
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
      ],
      { windowsHide: true }
    );
    const frames: Buffer[] = [];
    let cur = Buffer.allocUnsafe(bytes);
    let filled = 0;
    ff.stdout.on("data", (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length) {
        const take = Math.min(bytes - filled, chunk.length - off);
        chunk.copy(cur, filled, off, off + take);
        filled += take;
        off += take;
        if (filled === bytes) {
          frames.push(cur);
          cur = Buffer.allocUnsafe(bytes);
          filled = 0;
        }
      }
    });
    ff.on("close", () => resolve(frames));
  });
}

function bandDiffStats(a: Buffer, b: Buffer, band: Uint8Array, thresh: number) {
  const diffs: number[] = [];
  let over = 0;
  for (let p = 0; p < band.length; p++) {
    if (!band[p]) continue;
    const i = p * 3;
    const d = Math.max(
      Math.abs(b[i] - a[i]),
      Math.abs(b[i + 1] - a[i + 1]),
      Math.abs(b[i + 2] - a[i + 2])
    );
    diffs.push(d);
    if (d > thresh) over++;
  }
  diffs.sort((x, y) => x - y);
  const pct = (q: number) => diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * q))];
  return { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: diffs[diffs.length - 1], over, n: diffs.length };
}

async function main() {
  const lineKey = process.argv[2];
  const at = Number(process.argv[3]);
  const probe = JSON.parse(readFileSync(PROBE, "utf8")) as { videoPath: string; lines: SectorLine[] };
  const line = probe.lines.find((l) => l.lineKey === lineKey)!;
  const roi = roiFor(line, W, H);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const band = bandMask(line, roi, W, H, RECIPE_B22_T14);
  const crop = `crop=${w}:${h}:${roi.x0}:${roi.y0}`;

  // Colour is stored at half resolution and reconstructed on decode. On a red-on-white chevron
  // that reconstruction has to invent detail at the sharpest possible colour edge, and the recipe
  // then takes the LARGEST of the three channels — which is the most error-prone one. Grey tarmac
  // has no colour edge at all, which is exactly the split between the lines that work and don't.
  const variants: Array<[string, string]> = [
    ["as-is (rgb24)", crop],
    ["chroma: bilinear", `${crop},scale=flags=bilinear`],
    ["chroma: nearest", `${crop},scale=flags=neighbor`],
    ["chroma: full+accurate", `${crop},scale=flags=full_chroma_int+accurate_rnd`],
    ["LUMA ONLY (no colour)", `${crop},format=gray,format=rgb24`],
  ];

  console.log(`${lineKey} @ ${at}s · band ${(band.reduce((s, v) => s + v, 0) / 1000).toFixed(1)}k px\n`);
  console.log("variant                 p50   p90   p99   max   over-thresh");
  for (const [name, filter] of variants) {
    const frames = await decodeFrames(probe.videoPath, filter, w, h, at, 3);
    if (frames.length < 2) {
      console.log(`${name.padEnd(22)}  (decode failed)`);
      continue;
    }
    const s = bandDiffStats(frames[0], frames[1], band, RECIPE_B22_T14.thresh);
    console.log(
      `${name.padEnd(22)} ${String(s.p50).padStart(4)}  ${String(s.p90).padStart(4)}  ` +
        `${String(s.p99).padStart(4)}  ${String(s.max).padStart(4)}   ` +
        `${s.over} / ${s.n} (${((s.over / s.n) * 100).toFixed(2)}%)`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
