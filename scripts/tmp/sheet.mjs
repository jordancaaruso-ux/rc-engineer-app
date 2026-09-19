// Contact sheet: frames around a video time, cropped to a sector line, line drawn, time stamped.
//   node scripts/tmp/sheet.mjs <video> <lineKey> <centreSec> <halfSpanSec> <fps> <out.png> [title]
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const FF = "C:/Users/Jordan/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe";
const [video, lineKey, centreArg, halfArg, fpsArg, out, title = ""] = process.argv.slice(2);
const W = 3840, H = 2160;
const LINES = {
  sf: [0.2296725668031988, 0.4861409097804651, 0.2725826506729082, 0.4681100058513751],
  s1: [0.3529415350107275, 0.4209522571137551, 0.3537217183538132, 0.4070823310144551],
  s2: [0.5908974546518432, 0.402921353184665, 0.5908974546518432, 0.3890514270853651],
  s3: [0.7141664228593719, 0.5208157250287151, 0.7906243904817633, 0.6442580673124851],
  s4: [0.5651514043300175, 0.4278872201634051, 0.5643712209869319, 0.4681100058513751],
  s5: [0.5472071874390482, 0.3991938105454782, 0.5487675541252194, 0.411243308844245],
  s6: [0.3537217183538132, 0.4667230132414451, 0.3412387848644431, 0.4431441388726351],
};
const [nx1, ny1, nx2, ny2] = LINES[lineKey];
const x1 = nx1 * W, y1 = ny1 * H, x2 = nx2 * W, y2 = ny2 * H;
const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
const FINE = process.env.FINE === "1";
const CROP_W = FINE ? 360 : (lineKey === "s3" ? 900 : 640), CROP_H = FINE ? 220 : (lineKey === "s3" ? 560 : 400);
const cropX = Math.max(0, Math.min(W - CROP_W, Math.round(cx - CROP_W / 2)));
const cropY = Math.max(0, Math.min(H - CROP_H, Math.round(cy - CROP_H / 2)));
const centre = Number(centreArg), half = Number(halfArg), fps = Number(fpsArg);
const tmp = join(process.env.TEMP ?? ".", `sheet-${lineKey}-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
const from = Math.max(0, centre - half);
const r = spawnSync(FF, ["-v", "error", "-ss", String(from), "-i", video, "-t", String(2 * half), "-vf", `fps=${fps},crop=${CROP_W}:${CROP_H}:${cropX}:${cropY}`, join(tmp, "f%03d.png")], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const files = readdirSync(tmp).filter(f => f.endsWith(".png")).sort();
const COLS = FINE ? 5 : 6, TILE_W = FINE ? 540 : 320, TILE_H = Math.round(TILE_W * CROP_H / CROP_W);
const rows = Math.ceil(files.length / COLS);
const canvas = createCanvas(COLS * TILE_W, rows * TILE_H + 30);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#111"; ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif";
ctx.fillText(`${title} ${lineKey} centre ${centre.toFixed(2)}s ±${half}s @${fps}fps  crop ${cropX},${cropY}`, 8, 20);
for (let i = 0; i < files.length; i++) {
  const img = await loadImage(readFileSync(join(tmp, files[i])));
  const tx = (i % COLS) * TILE_W, ty = 30 + Math.floor(i / COLS) * TILE_H;
  ctx.drawImage(img, tx, ty, TILE_W, TILE_H);
  const s = TILE_W / CROP_W;
  ctx.strokeStyle = "#00ff00"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(tx + (x1 - cropX) * s, ty + (y1 - cropY) * s); ctx.lineTo(tx + (x2 - cropX) * s, ty + (y2 - cropY) * s); ctx.stroke();
  const t = from + i / fps;
  ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(tx, ty, 70, 18);
  ctx.fillStyle = "#ff0"; ctx.font = "13px sans-serif"; ctx.fillText(t.toFixed(2), tx + 3, ty + 14);
}
const { writeFileSync } = await import("node:fs");
writeFileSync(out, canvas.toBuffer("image/png"));
rmSync(tmp, { recursive: true, force: true });
console.log("wrote", out, files.length, "frames");
