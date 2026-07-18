import { readFileSync } from "node:fs";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration, alignToReference } from "./mtc3-common";

async function main() {
  const live = await loadLiveCalibration();
  const ref = live.imageCalibration.reference;
  const img = readFileSync("scripts/setup-extract-eval/mtc3-loop/cases/padded/ronald-setup-full.jpg");
  const aligned = await alignToReference(img, ref);
  // Wide crops of bottom-right aero area
  await sharp(aligned)
    .extract({ left: 950, top: 900, width: 700, height: 280 })
    .png()
    .toFile("scripts/setup-extract-eval/mtc3-loop/crops/ronald-aero-zone.png");
  for (const key of ["front_body_post_height", "above_rear_wheel_arch_height", "uptravel_limit_front"]) {
    const f = live.imageCalibration.fields.find((x) => x.key === key) as { region: { xPct: number; yPct: number; wPct: number; hPct: number } };
    const r = f.region;
    console.log(key, {
      px: {
        left: Math.round(r.xPct * ref.widthPx),
        top: Math.round(r.yPct * ref.heightPx),
        width: Math.round(r.wPct * ref.widthPx),
        height: Math.round(r.hPct * ref.heightPx),
      },
    });
  }
  console.log("wrote aero zone");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
