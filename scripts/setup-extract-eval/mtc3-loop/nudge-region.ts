/** Apply a targeted region nudge to a field of the LIVE MTC3 calibration.
 *  npx tsx ... nudge-region.ts --key=top_deck_thickness_rear --trim-left=0.15 [--trim-right=0.1] [--apply]
 *  Trims are fractions of the region's own width. Dry-run prints before/after. */
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration, saveLiveImageCalibration } from "./mtc3-common";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const key = arg("key");
  if (!key) { console.error("--key required"); process.exit(1); }
  const trimLeft = Number(arg("trim-left") ?? "0");
  const trimRight = Number(arg("trim-right") ?? "0");
  const trimTop = Number(arg("trim-top") ?? "0");
  const trimBottom = Number(arg("trim-bottom") ?? "0");
  const live = await loadLiveCalibration();
  const field = live.imageCalibration.fields.find((f) => f.key === key && f.kind === "text") as { region: ImageRegion } | undefined;
  if (!field) { console.error(`text field ${key} not found`); process.exit(1); }
  const r = field.region;
  const setJson = arg("set");
  const next: ImageRegion = setJson
    ? (JSON.parse(setJson) as ImageRegion)
    : {
        xPct: r.xPct + r.wPct * trimLeft,
        yPct: r.yPct + r.hPct * trimTop,
        wPct: r.wPct * (1 - trimLeft - trimRight),
        hPct: r.hPct * (1 - trimTop - trimBottom),
      };
  console.log(`before: ${JSON.stringify(r)}`);
  console.log(`after:  ${JSON.stringify(next)}`);
  if (!process.argv.includes("--apply")) { console.log("dry-run; pass --apply to write"); return; }
  field.region = next;
  await saveLiveImageCalibration(live.imageCalibration, live.rawData);
  console.log(`APPLIED to live calibration.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
