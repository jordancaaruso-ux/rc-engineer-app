import { readFileSync } from "node:fs";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import {
  loadLiveCalibration,
  detectContentBox,
  expectedAspectFromRef,
  alignToReference,
} from "./mtc3-common";

async function main() {
  const img = readFileSync("scripts/setup-extract-eval/mtc3-loop/cases/padded/ronald-petitrc.png");
  const live = await loadLiveCalibration();
  const meta = await sharp(img).metadata();
  const box = await detectContentBox(img, {
    expectedAspect: expectedAspectFromRef(live.imageCalibration.reference),
  });
  console.log("size", meta.width, meta.height);
  console.log("contentBox", box);
  const aligned = await alignToReference(img, live.imageCalibration.reference);
  await sharp(aligned).jpeg({ quality: 85 }).toFile(
    "scripts/setup-extract-eval/mtc3-loop/cases/padded/ronald-aligned.jpg"
  );
  console.log("wrote aligned");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
