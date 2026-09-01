import path from "node:path";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";
const PAGE = "/cars/cmpw8xx4a0005le04l8uwg99u/setups/cmthx2yi400s8vlckug9pnrvr";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com&to=${encodeURIComponent(PAGE)}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3500);
  const full = path.join(OUT, "rsl-full.png");
  await page.screenshot({ path: full, fullPage: true });
  await browser.close();

  // Crop the sheet's lower-left quadrant (chassis flex / LOWER DECK region).
  const img = await loadImage(full);
  const x = Math.round(img.width * 0.28);
  const y = Math.round(img.height * 0.64);
  const w = Math.round(img.width * 0.36);
  const h = Math.round(img.height * 0.12);
  const canvas = createCanvas(w * 2, h * 2);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, x, y, w, h, 0, 0, w * 2, h * 2);
  await writeFile(path.join(OUT, "rsl-crop.png"), canvas.toBuffer("image/png"));
  console.log("done");
}

main();
