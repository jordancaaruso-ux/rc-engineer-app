/** Dump aligned crops for specific keys from a case jpg, for visual diagnosis.
 *  npx tsx ... dump-crops.ts --case=case-02 --keys=camber_rear,toe_front,top_deck_thickness_rear */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration } from "./mtc3-common";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const caseName = arg("case") ?? "case-02";
  const keys = (arg("keys") ?? "").split(",").filter(Boolean);
  const live = await loadLiveCalibration();
  const ref = live.imageCalibration.reference;
  const imgPath = arg("img");
  const jpg = imgPath
    ? readFileSync(imgPath)
    : readFileSync(join(process.cwd(), "scripts", "setup-extract-eval", "mtc3-loop", "cases", `${caseName}.jpg`));
  const { alignToReference } = await import("./mtc3-common");
  const aligned = await alignToReference(jpg, ref);
  const outDir = join(process.cwd(), "scripts", "setup-extract-eval", "mtc3-loop", "crops");
  mkdirSync(outDir, { recursive: true });
  for (const key of keys) {
    const f = live.imageCalibration.fields.find((x) => x.key === key);
    if (!f) { console.log(`${key}: not found`); continue; }
    const regions: Array<{ tag: string; region: ImageRegion }> =
      f.kind === "text" || f.kind === "checkbox"
        ? [{ tag: key, region: (f as { region: ImageRegion }).region }]
        : (f as { options: Array<{ value: string; region: ImageRegion }> }).options.map((o) => ({ tag: `${key}__${o.value}`, region: o.region }));
    for (const { tag, region } of regions) {
      const px = {
        left: Math.round(region.xPct * ref.widthPx), top: Math.round(region.yPct * ref.heightPx),
        width: Math.round(region.wPct * ref.widthPx), height: Math.round(region.hPct * ref.heightPx),
      };
      // 4x upscale so the tiny crops are inspectable.
      const crop = await sharp(aligned).extract(px).resize(px.width * 4).png().toBuffer();
      writeFileSync(join(outDir, `${caseName}--${tag}.png`), crop);
      console.log(`${tag}: ${px.width}x${px.height} @ (${px.left},${px.top})`);
    }
  }
  console.log(`-> ${outDir}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
