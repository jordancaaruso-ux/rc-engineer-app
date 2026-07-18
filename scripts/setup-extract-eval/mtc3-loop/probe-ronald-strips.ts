import { readFileSync } from "node:fs";
import sharp from "sharp";

async function main() {
  const p = "scripts/setup-extract-eval/mtc3-loop/cases/padded/ronald-petitrc.png";
  const img = readFileSync(p);
  const meta = await sharp(img).metadata();
  console.log("ronald", meta.width, meta.height, meta.format);
  await sharp(img)
    .extract({ left: 0, top: 0, width: meta.width!, height: 80 })
    .png()
    .toFile("scripts/setup-extract-eval/mtc3-loop/crops/ronald-src-top.png");
  await sharp(img)
    .extract({ left: 0, top: 0, width: 120, height: meta.height! })
    .png()
    .toFile("scripts/setup-extract-eval/mtc3-loop/crops/ronald-src-left.png");
  const aligned = "scripts/setup-extract-eval/mtc3-loop/cases/padded/ronald-aligned.jpg";
  const am = await sharp(aligned).metadata();
  console.log("aligned", am.width, am.height);
  await sharp(aligned)
    .extract({ left: 0, top: 0, width: am.width!, height: 120 })
    .png()
    .toFile("scripts/setup-extract-eval/mtc3-loop/crops/ronald-aligned-top.png");
  // Also a known good field region mid-sheet on aligned
  await sharp(aligned)
    .extract({ left: 40, top: 40, width: 400, height: 200 })
    .png()
    .toFile("scripts/setup-extract-eval/mtc3-loop/crops/ronald-aligned-header.png");
  console.log("wrote strips");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
