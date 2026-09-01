/**
 * Dump the tracks one window produces, and why each was or wasn't believed.
 *
 * The signed-distance trace says WHERE the nearest thing was; this says WHAT was moving and
 * whether any of it held together. A window with plenty of samples and no track is the case
 * worth understanding — either the car is being seen in pieces that never link up, or the
 * quality bars are set for a faster corner than this one.
 *
 * Usage: npx tsx scripts/find-crossings-tracks.ts <lineKey> <centerSec> [--all]
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { WindowScanner } from "../src/lib/videoAnalysis/findCrossings/detector";
import { roiFor, bandMask } from "../src/lib/videoAnalysis/findCrossings/geometry";
import { spansFromMask } from "../src/lib/videoAnalysis/findCrossings/spans";
import { bandFrameDiffs, calibrateFromDiffs } from "../src/lib/videoAnalysis/findCrossings/calibrate";
import { buildTracks, trackCrossings } from "../src/lib/videoAnalysis/findCrossings/tracks";
import { RECIPE_B22_T14, type FrameCrop, type SectorLine } from "../src/lib/videoAnalysis/findCrossings/types";

const PROBE = "C:/Users/Jordan/Documents/rc-autosnap-results/autosnap-me/probe-data.json";
const W = 3840;
const H = 2160;
const WINDOW_SEC = 3;
const CAL_TIMES = [400, 470, 540, 610];
const CAL_SEC = 1.5;

function decode(
  videoPath: string,
  w: number,
  h: number,
  x0: number,
  y0: number,
  start: number,
  dur: number,
  luma: boolean,
  onFrame?: (f: FrameCrop, t: number) => void
): Promise<FrameCrop[]> {
  const bytes = w * h * 3;
  const filter = `crop=${w}:${h}:${x0}:${y0}` + (luma ? ",format=gray" : "");
  return new Promise((resolve) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", start.toFixed(6),
        "-i", videoPath,
        "-to", (start + dur).toFixed(6),
        "-copyts",
        "-fps_mode", "passthrough",
        "-vf", filter,
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
      ],
      { windowsHide: true }
    );
    const out: FrameCrop[] = [];
    let cur = Buffer.allocUnsafe(bytes);
    let filled = 0;
    let n = 0;
    ff.stdout.on("data", (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length) {
        const take = Math.min(bytes - filled, chunk.length - off);
        chunk.copy(cur, filled, off, off + take);
        filled += take;
        off += take;
        if (filled === bytes) {
          const frame: FrameCrop = { width: w, height: h, channels: 3, data: new Uint8Array(cur) };
          // Frame times are only needed relative to each other here; the validate harness reads
          // real timestamps from showinfo. Nominal spacing is fine for reading a single window.
          const t = start + n / 30;
          if (onFrame) onFrame(frame, t);
          else out.push(frame);
          n++;
          cur = Buffer.allocUnsafe(bytes);
          filled = 0;
        }
      }
    });
    ff.on("close", () => resolve(out));
  });
}

async function main() {
  const lineKey = process.argv[2];
  const center = Number(process.argv[3]);
  const showAll = process.argv.includes("--all");

  const probe = JSON.parse(readFileSync(PROBE, "utf8")) as { videoPath: string; lines: SectorLine[] };
  const line = probe.lines.find((l) => l.lineKey === lineKey)!;
  const roi = roiFor(line, W, H);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;

  const bm = bandMask(line, roi, W, H, RECIPE_B22_T14);
  const spans = spansFromMask(bm, w, h);
  const cd: number[] = [];
  const ld: number[] = [];
  for (const at of CAL_TIMES) {
    const [cf, lf] = await Promise.all([
      decode(probe.videoPath, w, h, roi.x0, roi.y0, at, CAL_SEC, false),
      decode(probe.videoPath, w, h, roi.x0, roi.y0, at, CAL_SEC, true),
    ]);
    const a = bandFrameDiffs(cf, bm, spans);
    const b = bandFrameDiffs(lf, bm, spans);
    const n = Math.min(a.length, b.length);
    cd.push(...a.slice(0, n));
    ld.push(...b.slice(0, n));
  }
  const cal = calibrateFromDiffs(cd, ld);
  console.log(`${lineKey} @ ${center}s · ${cal.mode} @ ${cal.thresh} (${cal.reason})\n`);

  const scanner = new WindowScanner(line, roi, W, H, { ...RECIPE_B22_T14, thresh: cal.thresh }, 3);
  await decode(
    probe.videoPath, w, h, roi.x0, roi.y0,
    center - WINDOW_SEC, WINDOW_SEC * 2, cal.mode === "luma",
    (f, t) => scanner.push(f, t)
  );

  const cfg = scanner.trackerConfig;
  console.log(
    `tracker: maxSpeed ${cfg.maxSpeedPxPerSec.toFixed(0)}px/s · minPoints ${cfg.minPoints} · ` +
      `minStraightness ${cfg.minStraightness} · minTravel ${cfg.minTravelPx.toFixed(0)}px\n`
  );

  const tracks = buildTracks(scanner.frames, cfg);
  const sorted = tracks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.points.length - a.t.points.length);

  console.log(`${scanner.frames.length} frames with blobs · ${tracks.length} tracks`);
  console.log("  pts  from     to      dur    net   path  strght  signed range          verdict");
  for (const { t } of sorted.slice(0, showAll ? tracks.length : 15)) {
    const signs = t.points.map((p) => p.signed);
    const lo = Math.min(...signs);
    const hi = Math.max(...signs);
    process.stdout.write(
      `  ${String(t.points.length).padStart(3)}  ${t.points[0].t.toFixed(3)}  ` +
        `${t.points[t.points.length - 1].t.toFixed(3)} `
    );
    const fails: string[] = [];
    if (t.points.length < cfg.minPoints) fails.push("short");
    if (t.straightness < cfg.minStraightness) fails.push("wanders");
    if (t.netTravel < cfg.minTravelPx) fails.push("no travel");
    console.log(
      `${t.duration.toFixed(2)}s ` +
        `${t.netTravel.toFixed(0).padStart(6)} ${t.pathLength.toFixed(0).padStart(6)}  ` +
        `${t.straightness.toFixed(2).padStart(5)}   ` +
        `${lo.toFixed(0).padStart(6)}..${hi.toFixed(0).padEnd(6)} ` +
        `${lo < 0 && hi > 0 ? "CROSSES " : "        "}` +
        (t.carLike ? "car-like" : fails.join(","))
    );
  }

  const crossings = trackCrossings(tracks, cfg);
  const anyCrossing = trackCrossings(tracks, cfg, false);
  console.log(
    `\ncar-like crossings: ${crossings.length}` +
      (crossings.length ? ` at ${crossings.map((c) => c.t.toFixed(3)).join(", ")}` : "") +
      `\nany-track crossings: ${anyCrossing.length}` +
      (anyCrossing.length ? ` at ${anyCrossing.map((c) => c.t.toFixed(3)).join(", ")}` : "")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
