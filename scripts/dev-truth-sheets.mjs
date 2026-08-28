/**
 * Dev only: contact sheets for building a ground truth by eye.
 *
 * For one driver's lap, one sheet per line: 48 consecutive frames (~1.6s) centred on where the
 * TIMING says the car is due — lap start from the transponder walk, plus that corner's typical
 * offset — never on the detector's answer, so the reviewer is choosing, not agreeing. Each tile is
 * cropped to the line, has the line drawn on it, and is stamped with the frame's exact video time
 * (from ffmpeg's own timestamps, not arithmetic).
 *
 *   node scripts/dev-truth-sheets.mjs <boronia.json> <video> <role> <lapNumber> <outDir>
 */
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const FF = "C:/Users/Jordan/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe";
const [jsonPath, video, role, lapArg, outDir, fineLine, fineCentre] = process.argv.slice(2);
const lapNumber = Number(lapArg);
const j = JSON.parse(readFileSync(jsonPath, "utf8"));
const FRAME_W = 1376, FRAME_H = 600;
// Coarse: 48 frames over 1.6s to FIND the car. Fine: 16 frames at twice the zoom to place the
// crossing to a frame — a 220px tile shows a pink smudge, not a car on a line.
// "wide:T" as the centre asks for the coarse 48-frame geometry on one named line (start/finish
// included), centred on T — for finding a car whose timing is not where the walk says.
const WIDE = typeof fineCentre === "string" && fineCentre.startsWith("wide:");
const FINE = Boolean(fineLine) && !WIDE;
const COLS = FINE ? 4 : 8, ROWS = FINE ? 4 : 6, N = COLS * ROWS, TILE_W = FINE ? 440 : 220;
const WINDOW_SEC = FINE ? N / 29.97 : 1.6;

/** Typical seconds after lap start for each line, from the cluster medians of the 08-27 scan. */
const OFFSETS = {
  me: { sf: 0, s1: 0.70, s2: 2.30, s3: 6.56, s4: 10.24, s5: 13.71 },
  competitor: { sf: 0, s1: 0.64, s2: 2.29, s3: 6.32, s4: 10.26, s5: 13.75 },
};
const NAMES = { me: "JORDAN CARUSO", competitor: "SANDY IAVAZZO" };

const driver = j.drivers.find((d) => d.name === NAMES[role]);
if (!driver) throw new Error("driver not in json");
// ANCHOR_SHIFT moves the whole timeline: the anchor Jordan set turned out to be his first loop
// crossing (end of lap 1), while the transponder's lap 1 starts at the tone, 1.386s earlier.
let lapStart = j.anchor.videoTimeSec + Number(process.env.ANCHOR_SHIFT ?? 0);
for (let i = 0; i < lapNumber - 1; i++) lapStart += driver.laps[i];
console.log(`${role} L${lapNumber}: starts ${lapStart.toFixed(3)}s, lap time ${driver.laps[lapNumber - 1]}s`);
mkdirSync(outDir, { recursive: true });

for (const line of j.lines.filter((l) => (fineLine ? l.key === fineLine : l.key !== "sf"))) {
  // Fine centre may be a time, or "due" for lap start + the corner's typical offset.
  const due = WIDE ? Number(fineCentre.slice(5)) : FINE ? (fineCentre === "due" ? lapStart + OFFSETS[role][line.key] : Number(fineCentre)) : lapStart + OFFSETS[role][line.key];
  const t0 = due - WINDOW_SEC / 2;

  // Crop: the line's box plus a generous margin, so neighbouring cars are in shot too.
  const px = [line.x1 * FRAME_W, line.x2 * FRAME_W], py = [line.y1 * FRAME_H, line.y2 * FRAME_H];
  const pad = (FINE ? 0.05 : 0.09) * FRAME_W;
  let cx0 = Math.max(0, Math.min(...px) - pad), cx1 = Math.min(FRAME_W, Math.max(...px) + pad);
  let cy0 = Math.max(0, Math.min(...py) - pad * 0.8), cy1 = Math.min(FRAME_H, Math.max(...py) + pad * 0.8);
  const cw = Math.round(cx1 - cx0), ch = Math.round(cy1 - cy0);
  const scale = TILE_W / cw;
  const tileH = 2 * Math.round((ch * scale) / 2);

  const tag = WIDE ? `-wide-${due.toFixed(2)}` : FINE ? `-fine-${Number(fineCentre).toFixed(2)}` : "";
  const raw = join(outDir, `${role}-L${lapNumber}-${line.key}${tag}-raw.png`);
  const args = ["-hide_banner", "-loglevel", "info", "-y", "-ss", t0.toFixed(3), "-i", video, "-copyts",
    // 48 INPUT frames become one tiled OUTPUT frame; -frames:v counts outputs.
    "-frames:v", "1",
    "-vf", `showinfo,trim=end_frame=${N},crop=${cw}:${ch}:${Math.round(cx0)}:${Math.round(cy0)},scale=${TILE_W}:${tileH},tile=${COLS}x${ROWS}`,
    raw];
  // showinfo writes each frame's timestamp to stderr; those are the labels, not arithmetic.
  const run = spawnSync(FF, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`ffmpeg failed for ${line.key}: ${run.stderr.slice(-400)}`);
  const pts = [...run.stderr.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1])).slice(0, N);

  const img = await loadImage(raw);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  for (let k = 0; k < N; k++) {
    const ox = (k % COLS) * TILE_W, oy = Math.floor(k / COLS) * tileH;
    ctx.strokeStyle = "rgba(255,214,0,0.95)"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + (px[0] - cx0) * scale, oy + (py[0] - cy0) * scale);
    ctx.lineTo(ox + (px[1] - cx0) * scale, oy + (py[1] - cy0) * scale);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, TILE_W - 1, tileH - 1);
    const label = `${k}  ${pts[k] != null ? pts[k].toFixed(3) : "?"}`;
    ctx.font = "bold 13px sans-serif";
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(ox + 2, oy + 2, w, 17);
    ctx.fillStyle = "#fff"; ctx.fillText(label, ox + 6, oy + 15);
  }
  const out = join(outDir, `${role}-L${lapNumber}-${line.key}${tag}.png`);
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(`  ${line.key} (${line.label}): due ${due.toFixed(3)}s, frames ${pts[0]?.toFixed(3)}..${pts[pts.length - 1]?.toFixed(3)} → ${out}`);
}
