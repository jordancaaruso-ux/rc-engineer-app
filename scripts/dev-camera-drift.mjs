/**
 * Dev only: does the camera move during the video?
 *
 * The sector lines are drawn once, in picture coordinates, and read on every frame. A camera on a
 * tripod in the wind drifts a few pixels over five minutes; a line drawn on a kerb at 0:10 then
 * sits beside the kerb at 4:00, and every crossing of it is read a little early or late. This
 * measures the shift of the picture at several times against the first second, by brute-force
 * search over a static patch (kerbs and track paint, no cars).
 *
 *   node scripts/dev-camera-drift.mjs <video> [t1,t2,...]   (default 60,120,180,240,300)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const FF = "C:/Users/Jordan/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe";
const [video, timesArg] = process.argv.slice(2);
const times = (timesArg ?? "60,120,180,240,300").split(",").map(Number);
// Reference patch, as fractions of the frame: the bottom-left quarter holds kerbs, the white
// track edge and painted arrows, and cars pass through it only briefly.
const PATCH = { x: 0.05, y: 0.45, w: 0.4, h: 0.4 };
const MAX_SHIFT = 12;

const dir = mkdtempSync(join(tmpdir(), "drift-"));
async function luma(t) {
  const out = join(dir, `f${t}.png`);
  const r = spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", video, "-frames:v", "1", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  const img = await loadImage(out);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const L = new Float32Array(img.width * img.height);
  for (let i = 0; i < L.length; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return { L, w: img.width, h: img.height };
}

const ref = await luma(1);
const px = Math.round(PATCH.x * ref.w), py = Math.round(PATCH.y * ref.h);
const pw = Math.round(PATCH.w * ref.w), ph = Math.round(PATCH.h * ref.h);
console.log(`frame ${ref.w}x${ref.h} · patch ${pw}x${ph} at ${px},${py} · search ±${MAX_SHIFT}px`);

for (const t of times) {
  const f = await luma(t);
  let best = { dx: 0, dy: 0, sad: Infinity };
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) {
    for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
      let sad = 0;
      for (let y = py; y < py + ph; y += 2) {
        const ro = y * ref.w, fo = (y + dy) * f.w + dx;
        for (let x = px; x < px + pw; x += 2) sad += Math.abs(ref.L[ro + x] - f.L[fo + x]);
      }
      if (sad < best.sad) best = { dx, dy, sad };
    }
  }
  const zero = (() => {
    let sad = 0;
    for (let y = py; y < py + ph; y += 2) for (let x = px; x < px + pw; x += 2) sad += Math.abs(ref.L[y * ref.w + x] - f.L[y * f.w + x]);
    return sad;
  })();
  console.log(`t=${String(t).padStart(3)}s: picture shifted dx=${best.dx >= 0 ? "+" : ""}${best.dx} dy=${best.dy >= 0 ? "+" : ""}${best.dy} px (match improves ${((1 - best.sad / zero) * 100).toFixed(0)}% over no shift)`);
}
rmSync(dir, { recursive: true, force: true });
