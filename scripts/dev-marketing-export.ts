/**
 * dev-marketing-export.ts — DEV ONLY. Web-sized copies of the marketing shots for the pitch page.
 *
 *   npm run shots:export
 *
 * The framed phone screens are 1179×2556 lossless PNGs, 1.5–2 MB each — right for print, wrong
 * for a page that shows five of them in a row 290px wide. This writes each one as a 900px-wide
 * WebP into public/landing/assets, which is still three times the slot's width so it stays sharp
 * on a Retina screen, at roughly a tenth of the bytes.
 *
 * Only the screens the page actually uses are exported; add to the list when a slot changes.
 * The pitch page references these by name, so keep the names stable.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const OUT = "public/landing/assets";
const PHONE_WIDTH = 900;
const QUALITY = 84;

/** framed phone screen → asset name on the page */
const PHONE_EXPORTS: Array<[string, string]> = [
  ["dashboard", "app-phone-dashboard"],
  ["analysis", "app-phone-analysis"],
  ["lab", "app-phone-lab"],
  ["run-laps-chart", "app-phone-field"],
  ["engineer", "app-phone-engineer"],
];

async function exportOne(src: string, dest: string, width: number) {
  const img = await loadImage(src);
  const height = Math.round((img.height / img.width) * width);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const bytes = await canvas.encode("webp", QUALITY);
  writeFileSync(dest, bytes);
  console.log(`  ${dest}  ${width}×${height}  ${(bytes.length / 1024).toFixed(0)} KB`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const [stem, name] of PHONE_EXPORTS) {
    const src = `marketing-shots/framed/phone/${stem}.png`;
    if (!existsSync(src)) { console.warn(`  ! missing ${src} — run shots:marketing then shots:stage`); continue; }
    await exportOne(src, `${OUT}/${name}.webp`, PHONE_WIDTH);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
