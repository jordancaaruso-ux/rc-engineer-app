/** Render the MTC3 image-calibration regions over the aligned filled image for visual diagnosis. */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

const CAL_ID = "cmpotp4qv0001l5043rtj9q70";
const FILLED = "C:/Users/Jordan/Downloads/mugen test setup.jpg";

async function main() {
  const cal = await prisma.setupSheetCalibration.findUnique({ where: { id: CAL_ID } });
  const img = normalizeCalibrationData(cal!.calibrationDataJson).imageCalibration!;
  const W = img.reference.widthPx;
  const H = img.reference.heightPx;
  const aligned = await sharp(readFileSync(FILLED)).removeAlpha().resize(W, H, { fit: "fill" }).png().toBuffer();

  const rects: string[] = [];
  for (const f of img.fields) {
    const draw = (r: ImageRegion, color: string) => {
      const x = (r.xPct * W).toFixed(1), y = (r.yPct * H).toFixed(1), w = (r.wPct * W).toFixed(1), h = (r.hPct * H).toFixed(1);
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="2"/>`);
    };
    if (f.kind === "text") { draw(f.region, "#1e90ff"); rects.push(`<text x="${(f.region.xPct * W).toFixed(1)}" y="${(f.region.yPct * H - 2).toFixed(1)}" fill="#1e90ff" font-size="11" font-family="monospace">${f.key}</text>`); }
    else if (f.kind === "checkbox") draw(f.region, "#00c853");
    else for (const o of (f as { options: Array<{ region: ImageRegion }> }).options) draw(o.region, "#ff1744");
  }
  const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${rects.join("")}</svg>`);
  const out = await sharp(aligned).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
  const path = join(process.cwd(), "scripts", "setup-extract-eval", "results", "mtc3-overlay.png");
  writeFileSync(path, out);
  console.log(`Wrote ${path} (${W}x${H}) — blue=text, red=choice options, green=checkbox`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
