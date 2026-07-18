/**
 * Move front_body_post_height + above_rear_wheel_arch_height boxes onto the 67 / 94
 * values visible on Ronald's PetitRC setup.jpg, then re-score those keys.
 *
 * Dry-run by default; pass --apply to write the live calibration.
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import {
  loadLiveCalibration,
  saveLiveImageCalibration,
  alignToReference,
  readImageThroughCalibration,
  compareField,
} from "./mtc3-common";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

async function main() {
  const live = await loadLiveCalibration();
  const ref = live.imageCalibration.reference;
  // Pixel boxes on the ALIGNED reference canvas (1684x1190), measured from ronald-aero-zone.
  // Zone origin (950,900). 67 sits in the front body diagram; 94 in the rear.
  const fixes: Record<string, { left: number; top: number; width: number; height: number }> = {
    front_body_post_height: { left: 1188, top: 1028, width: 52, height: 32 },
    above_rear_wheel_arch_height: { left: 1425, top: 1028, width: 52, height: 32 },
  };

  for (const [key, px] of Object.entries(fixes)) {
    const field = live.imageCalibration.fields.find((f) => f.key === key) as
      | { kind: string; region: ImageRegion }
      | undefined;
    if (!field || field.kind !== "text") throw new Error(`missing ${key}`);
    const next: ImageRegion = {
      xPct: px.left / ref.widthPx,
      yPct: px.top / ref.heightPx,
      wPct: px.width / ref.widthPx,
      hPct: px.height / ref.heightPx,
    };
    console.log(key, "before", field.region, "after", next);
    field.region = next;
  }

  const img = readFileSync("scripts/setup-extract-eval/mtc3-loop/cases/padded/ronald-setup-full.jpg");
  const aligned = await alignToReference(img, ref);
  for (const [key, px] of Object.entries(fixes)) {
    const crop = await sharp(aligned).extract(px).resize(px.width * 4).png().toBuffer();
    writeFileSync(`scripts/setup-extract-eval/mtc3-loop/crops/ronald-fixed--${key}.png`, crop);
  }

  if (process.argv.includes("--apply")) {
    await saveLiveImageCalibration(live.imageCalibration, live.rawData);
    console.log("APPLIED to live calibration");
  } else {
    console.log("dry-run (pass --apply to write)");
  }

  // Score just these keys with the in-memory (or applied) cal.
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const read = await readImageThroughCalibration(img, live.imageCalibration, apiKey);
  for (const [key, gold] of [
    ["front_body_post_height", "67"],
    ["above_rear_wheel_arch_height", "94"],
    ["uptravel_limit_front", "1.5"],
    ["uptravel_limit_rear", "1.3"],
  ] as const) {
    const v = String(read.parsedData[key] ?? "");
    console.log(`${compareField(gold, v) ? "OK" : "FAIL"} ${key}: gold=${gold} read=${JSON.stringify(v)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
