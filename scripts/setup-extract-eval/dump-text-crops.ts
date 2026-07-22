/**
 * Dump the exact text crops the OCR sees, raw and after removeFillInLines, for named fields.
 * Lets us eyeball WHY a field truncates ("37"->"3") or grows an "I" prefix.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/dump-text-crops.ts --cal=<id> --case=1 --keys=frspring,date,fr_tires
 *
 * Writes ./scratch-crops/<key>.raw.png, <key>.clean.png and a contact-sheet.png (all crops
 * stacked, scaled 3x with gold labels) for a single at-a-glance read.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { removeFillInLines } from "@/lib/setupCalibrations/imageExtractPipeline";
import type { ImageRegion } from "@/lib/setupCalibrations/types";
import {
  loadCalibrationForVerify,
  loadAcroGeometry,
  fillSyntheticCase,
  extractGoldFromFilledPdf,
  renderPdfFirstPageToPng,
} from "./selfVerifyCore";

function arg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

function regionToPixels(region: ImageRegion, widthPx: number, heightPx: number) {
  const left = Math.round(region.xPct * widthPx);
  const top = Math.round(region.yPct * heightPx);
  const width = Math.round(region.wPct * widthPx);
  const height = Math.round(region.hPct * heightPx);
  return { left, top, width: Math.max(1, width), height: Math.max(1, height) };
}

async function main() {
  const calId = arg("--cal");
  if (!calId) throw new Error("Pass --cal=<calibrationId>");
  const caseIndex = Number(arg("--case") ?? "1");
  const keys = (arg("--keys") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!keys.length) throw new Error("Pass --keys=a,b,c");
  const zoom = Number(arg("--zoom") ?? "3");
  const outDir = path.resolve("scratch-crops");
  await fs.mkdir(outDir, { recursive: true });

  const live = await loadCalibrationForVerify(calId);
  const geo = await loadAcroGeometry(live.blankPdfBytes);
  const filled = await fillSyntheticCase({ caseIndex, live, blankPdfBytes: live.blankPdfBytes, geo });
  const gold = await extractGoldFromFilledPdf(filled, live);
  const png = await renderPdfFirstPageToPng(new Uint8Array(filled), { scale: 2 });

  const ref = live.imageCalibration.reference;
  // Render dims match the reference canvas (verified bit-exact), so crop straight off the render.
  const meta = await sharp(png).metadata();
  const W = meta.width ?? ref.widthPx;
  const H = meta.height ?? ref.heightPx;
  console.log(`render ${W}x${H}, reference ${ref.widthPx}x${ref.heightPx}\n`);

  const rows: Array<{ input: Buffer; top: number; left: number }> = [];
  let y = 0;
  let maxW = 0;

  for (const key of keys) {
    const field = live.imageCalibration.fields.find((f) => f.key === key);
    if (!field || field.kind !== "text") { console.log(`${key}: not a text field`); continue; }
    const px = regionToPixels(field.region, W, H);
    const raw = await sharp(png).extract(px).png().toBuffer();
    const clean = await removeFillInLines(raw);
    await fs.writeFile(path.join(outDir, `${key}.raw.png`), raw);
    await fs.writeFile(path.join(outDir, `${key}.clean.png`), clean);
    const g = String(gold.values[key] ?? "");
    console.log(`${key}: gold="${g}" region px ${px.width}x${px.height} at (${px.left},${px.top})`);

    // Contact sheet row: label | raw | clean, all scaled up.
    const up = (b: Buffer) => sharp(b).resize({ width: px.width * zoom, height: px.height * zoom, fit: "fill", kernel: "nearest" }).png().toBuffer();
    const rawUp = await up(raw);
    const cleanUp = await up(clean);
    const rowH = Math.max(28, px.height * zoom);
    const labelW = 260;
    const label = Buffer.from(
      `<svg width="${labelW}" height="${rowH}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="100%" height="100%" fill="#fff"/>` +
      `<text x="4" y="${Math.round(rowH / 2) + 5}" font-family="monospace" font-size="13" fill="#000">${key} = "${g.replace(/[<&]/g, "")}"</text>` +
      `</svg>`
    );
    rows.push({ input: label, top: y, left: 0 });
    rows.push({ input: rawUp, top: y, left: labelW + 8 });
    rows.push({ input: cleanUp, top: y, left: labelW + 8 + px.width * zoom + 16 });
    maxW = Math.max(maxW, labelW + 8 + px.width * zoom * 2 + 32);
    y += rowH + 10;
  }

  if (rows.length) {
    const sheet = await sharp({ create: { width: Math.max(400, maxW), height: Math.max(1, y), channels: 3, background: { r: 235, g: 235, b: 240 } } })
      .composite(rows).png().toBuffer();
    await fs.writeFile(path.join(outDir, "contact-sheet.png"), sheet);
    console.log(`\nWrote ${outDir}\\contact-sheet.png  (left = raw crop, right = after removeFillInLines)`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
