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

const PROBE = "C:/Users/Jordan/Documents/rc-autosnap-results/autosnap-me/probe-data.json";
const WINDOW_SEC = 3;

async function main() {
  const lineKey = process.argv[2];
  const center = Number(process.argv[3]);
  const rowsArg = process.argv.indexOf("--rows");
  const maxRows = rowsArg >= 0 ? Number(process.argv[rowsArg + 1]) : 40;

  const probe = JSON.parse(readFileSync(PROBE, "utf8")) as { videoPath: string; lines: SectorLine[] };
  const line = probe.lines.find((l) => l.lineKey === lineKey)!;
  const W = 3840;
  const H = 2160;

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
      "-vf", `crop=${w}:${h}:${roi.x0}:${roi.y0},showinfo`,
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
        gaussianBlur5({ width: w, height: h, channels: 3, data: view }, bandSpans, horizSpans, scratch);
        const t = times[n];
        n++;
        if (n === 1) continue;

        motionMaskInBand(
          { width: w, height: h, channels: 3, data: prevBuf },
          { width: w, height: h, channels: 3, data: cur },
          RECIPE_B22_T14.thresh,
          band,
          bandSpans,
          motion
        );
        let firing = 0;
        for (let i = 0; i < motion.length; i++) firing += motion[i];

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
            `${(t ?? 0).toFixed(3)}  fire ${String(firing).padStart(5)}  blobs ${String(blobs.length).padStart(3)}  ` +
            `signed ${nearest == null ? "     -" : nearest.toFixed(1).padStart(7)}  ` +
            `at (${nx.toFixed(0)},${ny.toFixed(0)}) a${String(narea.toFixed(0)).padStart(5)}  ` +
            `moved ${Number.isNaN(moved) ? "   -" : moved.toFixed(1).padStart(5)}px`,
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
