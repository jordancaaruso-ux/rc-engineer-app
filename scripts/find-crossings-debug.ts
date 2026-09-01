/**
 * Dump one window's raw signed-distance trace, plus how much of the band is firing per frame.
 *
 * Exists because "detected the wrong time" and "detected constant noise" look identical in the
 * summary table. Coherent motion walks the trace smoothly across zero; sensor noise scatters it.
 *
 * Usage: npx tsx scripts/find-crossings-debug.ts <lineKey> <centerSec> [--rows N]
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { bandMask, lineGeom, roiFor, signedDistance } from "../src/lib/videoAnalysis/findCrossings/geometry";
import { dilate5, findBlobs, gaussianBlur5, motionMaskInBand } from "../src/lib/videoAnalysis/findCrossings/imageOps";
import { expandSpans, spanArea, spansFromMask } from "../src/lib/videoAnalysis/findCrossings/spans";
import { RECIPE_B22_T14, type SectorLine } from "../src/lib/videoAnalysis/findCrossings/types";

// PROBE_JSON / PROBE_W / PROBE_H override the default probe set (2026-08-29: used to re-read the
// Test A3 S1 windows on IMG_4483, 2606x1074).
const PROBE = process.env.PROBE_JSON ?? "C:/Users/Jordan/Documents/rc-autosnap-results/autosnap-me/probe-data.json";
const WINDOW_SEC = 3;

async function main() {
  const lineKey = process.argv[2];
  const center = Number(process.argv[3]);
  const rowsArg = process.argv.indexOf("--rows");
  const maxRows = rowsArg >= 0 ? Number(process.argv[rowsArg + 1]) : 40;

  const probe = JSON.parse(readFileSync(PROBE, "utf8")) as { videoPath: string; lines: SectorLine[] };
  const line = probe.lines.find((l) => l.lineKey === lineKey)!;
  const W = Number(process.env.PROBE_W ?? 3840);
  const H = Number(process.env.PROBE_H ?? 2160);

  const roi = roiFor(line, W, H);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const band = bandMask(line, roi, W, H, RECIPE_B22_T14);
  const bandSpans = spansFromMask(band, w, h);
  const horizSpans = expandSpans(bandSpans, 2);
  const dilSpans = [expandSpans(bandSpans, 2), expandSpans(bandSpans, 4)];
  const geom = lineGeom(line, W, H);

  let bandPx = 0;
  for (let i = 0; i < band.length; i++) bandPx += band[i];
  const g = lineGeom(line, W, H);
  console.log(
    `${lineKey}: line ${g.norm.toFixed(1)}px · roi ${w}x${h} (${(w * h / 1000).toFixed(0)}k) · ` +
      `band ${(bandPx / 1000).toFixed(1)}k px · spans ${(spanArea(bandSpans) / 1000).toFixed(1)}k px`
  );

  const px = w * h;
  const bytes = px * 3;
  const scratch = { horiz: new Int32Array(bytes), out: new Uint8Array(bytes) };
  const blurA = new Uint8Array(bytes);
  const blurB = new Uint8Array(bytes);
  const motion = new Uint8Array(px);
  const dilBuf = { a: new Uint8Array(px), b: new Uint8Array(px), horiz: new Uint8Array(px) };
  const LUMA = process.env.PROBE_LUMA === "1";
  const NORM = process.env.PROBE_NORM === "1";
  let prevMean = 0;
  const CH = LUMA ? 1 : 3;
  const lumaBuf = new Uint8Array(px);
  const seen = new Uint8Array(px);
  const stack = new Int32Array(px);

  const start = center - WINDOW_SEC;
  const ff = spawn(
    "ffmpeg",
    [
      "-hide_banner", "-nostdin", "-copyts",
      "-ss", start.toFixed(6),
      "-i", probe.videoPath,
      "-to", (start + WINDOW_SEC * 2).toFixed(6),
      "-fps_mode", "passthrough",
      // Crop AFTER converting to RGB: on a chroma-subsampled source ffmpeg rounds an odd crop
      // width/height/offset down to even, every row of every frame then lands a few bytes off, and
      // the trace is garbage (2026-08-29: a 469px ROI read as constant motion on a still scene).
      "-vf", `format=rgb24,crop=${w}:${h}:${roi.x0}:${roi.y0}:exact=1,showinfo`,
      "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ],
    { windowsHide: true }
  );

  const times: number[] = [];
  ff.stderr.on("data", (d: Buffer) => {
    for (const m of d.toString().matchAll(/pts_time:([-\d.]+)/g)) times.push(Number(m[1]));
  });

  const frame = Buffer.allocUnsafe(bytes);
  const view = new Uint8Array(frame.buffer, frame.byteOffset, bytes);
  let filled = 0;
  let n = 0;
  const rows: Array<{ t: number; line: string }> = [];
  let prevPos: [number, number] | null = null;

  await new Promise<void>((resolve) => {
    ff.stdout.on("data", (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length) {
        const take = Math.min(bytes - filled, chunk.length - off);
        chunk.copy(frame, filled, off, off + take);
        filled += take;
        off += take;
        if (filled < bytes) continue;
        filled = 0;

        const cur = n % 2 === 0 ? blurA : blurB;
        const prevBuf = n % 2 === 0 ? blurB : blurA;
        scratch.out = cur;
        // PROBE_LUMA=1 reads motion on brightness, as the browser scan does on a line whose
        // calibration chose luma (Test A3 S1, 2026-08-29) — per-channel colour differences at a
        // dark far-end line fire on sensor noise alone.
        if (LUMA) {
          for (let i = 0, j = 0; j < px; i += 3, j++) lumaBuf[j] = (view[i] * 77 + view[i + 1] * 150 + view[i + 2] * 29) >> 8;
          // PROBE_NORM=1: cancel light flicker. Floodlights beating against the shutter shift the
          // whole band's brightness by ±15 a frame (Test A3 S1); scale this frame so the band's mean
          // matches the previous frame's, and only what moved locally is left to differ.
          if (NORM) {
            let sum = 0, cnt = 0;
            for (let i = 0; i < band.length; i++) if (band[i]) { sum += lumaBuf[i]; cnt++; }
            const mean = cnt ? sum / cnt : 0;
            if (prevMean > 0 && mean > 0) { const g = prevMean / mean; for (let i = 0; i < px; i++) lumaBuf[i] = Math.min(255, Math.round(lumaBuf[i] * g)); }
            else prevMean = mean;
            if (prevMean <= 0) prevMean = mean;
          }
          gaussianBlur5({ width: w, height: h, channels: 1, data: lumaBuf }, bandSpans, horizSpans, scratch);
        } else {
          gaussianBlur5({ width: w, height: h, channels: 3, data: view }, bandSpans, horizSpans, scratch);
        }
        const t = times[n];
        n++;
        if (n === 1) continue;

        motionMaskInBand(
          { width: w, height: h, channels: CH, data: prevBuf },
          { width: w, height: h, channels: CH, data: cur },
          RECIPE_B22_T14.thresh,
          band,
          bandSpans,
          motion
        );
        let firing = 0;
        for (let i = 0; i < motion.length; i++) firing += motion[i];
        // PROBE_HIST=1: the raw |Δ| of blurred band pixels this frame vs last — median / p90 / p99 —
        // so noise, flicker and a car can be told apart without a threshold in the way.
        let hist = "";
        if (process.env.PROBE_HIST === "1") {
          const ds: number[] = [];
          for (let i = 0; i < band.length; i++) if (band[i]) ds.push(Math.abs(cur[i * CH] - prevBuf[i * CH]));
          ds.sort((x, y) => x - y);
          const q = (f: number) => ds[Math.min(ds.length - 1, Math.floor(ds.length * f))];
          hist = ` |Δ| p50 ${String(q(0.5)).padStart(3)} p90 ${String(q(0.9)).padStart(3)} p99 ${String(q(0.99)).padStart(3)}`;
        }
        // Mean brightness of the band this frame: a whole patch pulsing frame to frame is light
        // flicker (LED floodlights against a 30fps shutter), not motion.
        let lumaSum = 0, lumaN = 0;
        if (LUMA) for (let i = 0; i < band.length; i++) if (band[i]) { lumaSum += cur[i]; lumaN++; }
        const bandMean = lumaN ? lumaSum / lumaN : NaN;

        const grown = dilate5(motion, w, h, dilSpans, dilBuf);
        const blobs = findBlobs(grown, w, h, RECIPE_B22_T14.minArea, dilSpans[1], seen, stack);
        let nearest: number | null = null;
        let area = 0;
        for (const b of blobs) {
          const s = signedDistance(geom, b.cx + roi.x0, b.cy + roi.y0);
          if (nearest == null || Math.abs(s) < Math.abs(nearest)) {
            nearest = s;
            area = b.area;
          }
        }
        // Track where the chosen blob actually is, and how far it moved since the last frame.
        // A car sweeps across the band; shimmer clings to whatever painted edge produced it.
        let nx = 0;
        let ny = 0;
        let narea = 0;
        for (const b of blobs) {
          const s = signedDistance(geom, b.cx + roi.x0, b.cy + roi.y0);
          if (nearest != null && s === nearest) {
            nx = b.cx;
            ny = b.cy;
            narea = b.area;
          }
        }
        const moved = prevPos && nearest != null ? Math.hypot(nx - prevPos[0], ny - prevPos[1]) : NaN;
        if (nearest != null) prevPos = [nx, ny];

        rows.push({
          t: t ?? 0,
          line:
            `${(t ?? 0).toFixed(3)}  mean ${Number.isNaN(bandMean) ? "  -  " : bandMean.toFixed(1).padStart(5)}  fire ${String(firing).padStart(5)}  blobs ${String(blobs.length).padStart(3)}  ` +
            `signed ${nearest == null ? "     -" : nearest.toFixed(1).padStart(7)}  ` +
            `at (${nx.toFixed(0)},${ny.toFixed(0)}) a${String(narea.toFixed(0)).padStart(5)}  ` +
            `moved ${Number.isNaN(moved) ? "   -" : moved.toFixed(1).padStart(5)}px${hist}`,
        });
      }
    });
    ff.on("close", () => resolve());
  });

  const fromArg = process.argv.indexOf("--from");
  const toArg = process.argv.indexOf("--to");
  const from = fromArg >= 0 ? Number(process.argv[fromArg + 1]) : -Infinity;
  const to = toArg >= 0 ? Number(process.argv[toArg + 1]) : Infinity;
  const shown = rows.filter((r) => r.t >= from && r.t <= to);
  const step = Math.max(1, Math.floor(shown.length / maxRows));
  console.log(`\n${rows.length} frames · showing ${shown.length} in range, every ${step}:\n`);
  for (let i = 0; i < shown.length; i += step) console.log(shown[i].line);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
