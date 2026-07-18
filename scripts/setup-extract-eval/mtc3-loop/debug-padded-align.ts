/**
 * Diagnose why padded screenshots mis-align: dump detected boxes + save aligned PNGs.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import {
  loadLiveCalibration,
  detectContentBox,
  alignToReference,
} from "./mtc3-common";

const OUT = join(process.cwd(), "scripts/setup-extract-eval/mtc3-loop/cases/padded");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const live = await loadLiveCalibration();
  const ref = live.imageCalibration.reference;
  console.log("ref.contentBox", JSON.stringify(ref.contentBox));

  for (const name of ["pad-10pct.jpg", "pad-18pct.jpg", "pad-asymmetric.jpg", "../case-01.jpg"]) {
    const path = join(OUT, name.startsWith("..") ? name.replace("../", "") : name);
    const file = name.startsWith("..")
      ? join(process.cwd(), "scripts/setup-extract-eval/mtc3-loop/cases/case-01.jpg")
      : path;
    const buf = readFileSync(file);
    const meta = await sharp(buf).metadata();
    const box = await detectContentBox(buf);
    console.log("\n", name, `${meta.width}x${meta.height}`);
    console.log("  detected", JSON.stringify(box));
    if (box && ref.contentBox) {
      const dx = box.xPct - ref.contentBox.xPct;
      const dy = box.yPct - ref.contentBox.yPct;
      const dw = box.wPct - ref.contentBox.wPct;
      const dh = box.hPct - ref.contentBox.hPct;
      console.log(
        `  delta vs ref: dx=${dx.toFixed(4)} dy=${dy.toFixed(4)} dw=${dw.toFixed(4)} dh=${dh.toFixed(4)}`
      );
    }
    const aligned = await alignToReference(buf, ref);
    const outName = `aligned-${name.replace(/^\.\.\//, "").replace(/\.jpg$/, "")}.png`;
    writeFileSync(join(OUT, outName), aligned);
    console.log("  wrote", outName);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
