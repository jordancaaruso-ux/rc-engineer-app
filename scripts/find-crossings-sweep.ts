/**
 * Decode one window once, then run the detector over it at several thresholds.
 *
 * Answers a specific question: the corner lines disagree with the 2026-07 probe because our
 * band fires on hundreds of pixels in EVERY frame, where the probe's fired on almost none.
 * If a higher threshold makes our answer converge on the probe's, the difference is picture
 * contrast (how the HDR source got flattened to 8-bit), not the algorithm.
 *
 * Usage: npx tsx scripts/find-crossings-sweep.ts <lineKey> <centerSec> [thresh...]
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { WindowScanner, resultFromSamples } from "../src/lib/videoAnalysis/findCrossings/detector";
import { bandMask, roiFor } from "../src/lib/videoAnalysis/findCrossings/geometry";
import { RECIPE_B22_T14, type SectorLine } from "../src/lib/videoAnalysis/findCrossings/types";

const PROBE = "C:/Users/Jordan/Documents/rc-autosnap-results/autosnap-me/probe-data.json";
const WINDOW_SEC = 3;
const W = 3840;
const H = 2160;

function decodeWindow(videoPath: string, w: number, h: number, x: number, y: number, startSec: number) {
  const bytes = w * h * 3;
  return new Promise<{ frames: Buffer[]; times: number[] }>((resolve) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin", "-copyts",
        "-ss", startSec.toFixed(6),
        "-i", videoPath,
        "-to", (startSec + WINDOW_SEC * 2).toFixed(6),
        "-fps_mode", "passthrough",
        "-vf", `crop=${w}:${h}:${x}:${y},showinfo`,
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
      ],
      { windowsHide: true }
    );
    const times: number[] = [];
    const frames: Buffer[] = [];
    ff.stderr.on("data", (d: Buffer) => {
      for (const m of d.toString().matchAll(/pts_time:([-\d.]+)/g)) times.push(Number(m[1]));
    });
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
    ff.on("close", () => resolve({ frames, times }));
  });
}

async function main() {
  const lineKey = process.argv[2];
  const center = Number(process.argv[3]);
  const threshes = process.argv.slice(4).map(Number).filter((n) => Number.isFinite(n));
  const list = threshes.length ? threshes : [14, 18, 22, 26, 30, 36];

  const probe = JSON.parse(readFileSync(PROBE, "utf8")) as { videoPath: string; lines: SectorLine[] };
  const line = probe.lines.find((l) => l.lineKey === lineKey)!;
  const roi = roiFor(line, W, H);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;

  const { frames, times } = await decodeWindow(probe.videoPath, w, h, roi.x0, roi.y0, center - WINDOW_SEC);

  // How big are the frame-to-frame differences inside the band on a quiet pair of frames?
  // If the bulk of them sit near the threshold, the threshold is the whole story.
  const band = bandMask(line, roi, W, H, RECIPE_B22_T14);
  if (frames.length > 2) {
    const a = frames[0];
    const b = frames[1];
    const diffs: number[] = [];
    for (let p = 0; p < band.length; p++) {
      if (!band[p]) continue;
      const i = p * 3;
      diffs.push(
        Math.max(Math.abs(b[i] - a[i]), Math.abs(b[i + 1] - a[i + 1]), Math.abs(b[i + 2] - a[i + 2]))
      );
    }
    diffs.sort((x, y) => x - y);
    const pct = (q: number) => diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * q))];
    console.log(
      `${lineKey} @ ${center.toFixed(3)} · ${frames.length} frames · band ${(diffs.length / 1000).toFixed(1)}k px\n` +
        `raw inter-frame diff in band (unblurred): p50 ${pct(0.5)} · p90 ${pct(0.9)} · ` +
        `p99 ${pct(0.99)} · p99.9 ${pct(0.999)} · max ${diffs[diffs.length - 1]}\n`
    );
  }

  // A band is `bandFrac` of the FULL FRAME WIDTH either side of the line, regardless of how
  // long the line is. On a short line that makes the band wider than the line — on this footage
  // s1 is a 75px line inside a 168px-wide band — so it spans the neighbouring leg of the
  // switchback and sees the car twice a lap. Sweeping the width tests exactly that.
  const bandArg = process.argv.indexOf("--band");
  if (bandArg >= 0) {
    const fracs = process.argv[bandArg + 1].split(",").map(Number);
    console.log("bandFrac  halfWidth  bandPx  samples  events  detected");
    for (const bandFrac of fracs) {
      const params = { ...RECIPE_B22_T14, bandFrac };
      const scanner = new WindowScanner(line, roi, W, H, params);
      for (let i = 0; i < frames.length; i++) {
        const t = times[i];
        if (t == null) continue;
        scanner.push({ width: w, height: h, channels: 3, data: new Uint8Array(frames[i]) }, t);
      }
      const r = resultFromSamples(
        { id: "b", lineKey, lapNumber: 0, centerSec: center, truthSec: null },
        scanner.samples
      );
      const bm = bandMask(line, roi, W, H, params);
      let n = 0;
      for (let i = 0; i < bm.length; i++) n += bm[i];
      console.log(
        `${bandFrac.toFixed(4).padStart(8)}  ${String(Math.max(20, Math.trunc(W * bandFrac))).padStart(9)}  ` +
          `${String(n).padStart(6)}  ${String(scanner.samples.length).padStart(7)}  ` +
          `${String(r.eventCount).padStart(6)}  ${r.detectedSec?.toFixed(4) ?? "MISS"}`
      );
    }
    return;
  }

  // minArea gates how big a moving blob must be to count. The recipe's 12 is essentially "any
  // motion at all" — the two dilate passes inflate a single stray pixel past it — which is fine
  // on a band that only moves when a car is in it, and useless on one that shimmers. A car in
  // these crops measures 1500-5000.
  const areaArg = process.argv.indexOf("--minarea");
  if (areaArg >= 0) {
    const areas = process.argv[areaArg + 1].split(",").map(Number);
    console.log("minArea  samples  events  detected");
    for (const minArea of areas) {
      const scanner = new WindowScanner(line, roi, W, H, { ...RECIPE_B22_T14, minArea });
      for (let i = 0; i < frames.length; i++) {
        const t = times[i];
        if (t == null) continue;
        scanner.push({ width: w, height: h, channels: 3, data: new Uint8Array(frames[i]) }, t);
      }
      const r = resultFromSamples(
        { id: "a", lineKey, lapNumber: 0, centerSec: center, truthSec: null },
        scanner.samples
      );
      console.log(
        `${String(minArea).padStart(7)}  ${String(scanner.samples.length).padStart(7)}  ` +
          `${String(r.eventCount).padStart(6)}  ${r.detectedSec?.toFixed(4) ?? "MISS"}`
      );
    }
    return;
  }

  console.log("thresh  samples  events  detected");
  for (const thresh of list) {
    const scanner = new WindowScanner(line, roi, W, H, { ...RECIPE_B22_T14, thresh });
    for (let i = 0; i < frames.length; i++) {
      const t = times[i];
      if (t == null) continue;
      scanner.push({ width: w, height: h, channels: 3, data: new Uint8Array(frames[i]) }, t);
    }
    const r = resultFromSamples(
      { id: "t", lineKey, lapNumber: 0, centerSec: center, truthSec: null },
      scanner.samples
    );
    console.log(
      `${String(thresh).padStart(6)}  ${String(scanner.samples.length).padStart(7)}  ` +
        `${String(r.eventCount).padStart(6)}  ${r.detectedSec?.toFixed(4) ?? "MISS"}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
