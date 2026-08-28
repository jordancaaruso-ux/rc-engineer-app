/**
 * Render what the detector actually sees: the crop, the band, and the pixels that fired.
 *
 * Every theory so far has been tested against numbers. This draws it instead, because "seven
 * blobs in the band" is consistent with compression noise, with other cars, and with scenery
 * shimmer, and those want completely different fixes.
 *
 * Usage: npx tsx scripts/find-crossings-render.ts <lineKey> <atSec> <out.png>
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import sharp from "sharp";

import { bandMask, lineGeom, roiFor, signedDistance } from "../src/lib/videoAnalysis/findCrossings/geometry";
import { dilate5, findBlobs, gaussianBlur5, motionMaskInBand } from "../src/lib/videoAnalysis/findCrossings/imageOps";
import { expandSpans, spansFromMask } from "../src/lib/videoAnalysis/findCrossings/spans";
import { RECIPE_B22_T14, type SectorLine } from "../src/lib/videoAnalysis/findCrossings/types";

const PROBE = "C:/Users/Jordan/Documents/rc-autosnap-results/autosnap-me/probe-data.json";
const W = 3840;
const H = 2160;

async function main() {
  const lineKey = process.argv[2];
  const at = Number(process.argv[3]);
  const out = process.argv[4];
  const useLuma = process.argv.includes("--luma");
  const threshArg = process.argv.indexOf("--thresh");
  const params = {
    ...RECIPE_B22_T14,
    thresh: threshArg >= 0 ? Number(process.argv[threshArg + 1]) : RECIPE_B22_T14.thresh,
  };

  const probe = JSON.parse(readFileSync(PROBE, "utf8")) as { videoPath: string; lines: SectorLine[] };
  const line = probe.lines.find((l) => l.lineKey === lineKey)!;
  const roi = roiFor(line, W, H);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const band = bandMask(line, roi, W, H, params);
  const bandSpans = spansFromMask(band, w, h);
  const horizSpans = expandSpans(bandSpans, 2);
  const dilSpans = [expandSpans(bandSpans, 2), expandSpans(bandSpans, 4)];
  const geom = lineGeom(line, W, H);

  const px = w * h;
  const bytes = px * 3;

  const frames: Buffer[] = await new Promise((resolve) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", (at - 0.1).toFixed(6), "-i", probe.videoPath,
        "-frames:v", "4", "-fps_mode", "passthrough",
        "-vf", `crop=${w}:${h}:${roi.x0}:${roi.y0}` + (useLuma ? ",format=gray" : ""),
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
      ],
      { windowsHide: true }
    );
    const got: Buffer[] = [];
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
          got.push(cur);
          cur = Buffer.allocUnsafe(bytes);
          filled = 0;
        }
      }
    });
    ff.on("close", () => resolve(got));
  });

  if (frames.length < 2) throw new Error("need two frames");

  const scratch = { horiz: new Int32Array(bytes), out: new Uint8Array(bytes) };
  const blurA = new Uint8Array(bytes);
  const blurB = new Uint8Array(bytes);
  scratch.out = blurA;
  const a = gaussianBlur5({ width: w, height: h, channels: 3, data: new Uint8Array(frames[0]) }, bandSpans, horizSpans, scratch);
  scratch.out = blurB;
  const b = gaussianBlur5({ width: w, height: h, channels: 3, data: new Uint8Array(frames[1]) }, bandSpans, horizSpans, scratch);

  const motion = new Uint8Array(px);
  motionMaskInBand(a, b, params.thresh, band, bandSpans, motion);
  const dilBuf = { a: new Uint8Array(px), b: new Uint8Array(px), horiz: new Uint8Array(px) };
  const grown = dilate5(motion, w, h, dilSpans, dilBuf);
  const blobs = findBlobs(grown, w, h, params.minArea, dilSpans[1], new Uint8Array(px), new Int32Array(px));

  // Paint: dim everything outside the band, tint the band, fired pixels red, blob centres green.
  const img = Buffer.from(frames[1]);
  for (let p = 0; p < px; p++) {
    const i = p * 3;
    if (!band[p]) {
      img[i] = (img[i] * 0.45) | 0;
      img[i + 1] = (img[i + 1] * 0.45) | 0;
      img[i + 2] = (img[i + 2] * 0.45) | 0;
    } else {
      img[i + 2] = Math.min(255, img[i + 2] + 30);
    }
    if (grown[p]) {
      img[i] = 255;
      img[i + 1] = (img[i + 1] * 0.2) | 0;
      img[i + 2] = (img[i + 2] * 0.2) | 0;
    }
  }
  for (const bl of blobs) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = Math.round(bl.cx) + dx;
        const y = Math.round(bl.cy) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 3;
        img[i] = 0;
        img[i + 1] = 255;
        img[i + 2] = 0;
      }
    }
  }

  await sharp(img, { raw: { width: w, height: h, channels: 3 } })
    .resize({ width: Math.min(w, 900) })
    .png()
    .toFile(out);

  console.log(
    `${lineKey} @ ${at} · ${blobs.length} blobs · areas ` +
      blobs
        .slice()
        .sort((x, y) => y.area - x.area)
        .map((bl) => `a${bl.area.toFixed(0)}/c${bl.compactness.toFixed(2)}@${signedDistance(geom, bl.cx + roi.x0, bl.cy + roi.y0).toFixed(0)}`)
        .join(" ") +
      `\nwrote ${out}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
