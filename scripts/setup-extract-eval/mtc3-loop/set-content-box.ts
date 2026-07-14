import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { renderPdfPage1ToPng } from "../renderPdfToImage";
import { loadLiveCalibration, saveLiveImageCalibration, detectContentBox, EDITABLE_PDF } from "./mtc3-common";

async function main() {
  const live = await loadLiveCalibration();
  const blank = await renderPdfPage1ToPng(readFileSync(EDITABLE_PDF), live.imageCalibration.reference.widthPx);
  const box = await detectContentBox(blank);
  if (!box) throw new Error("no content box detected on blank render");
  console.log("reference contentBox:", JSON.stringify(box));
  live.imageCalibration.reference.contentBox = box;
  if (process.argv.includes("--apply")) {
    await saveLiveImageCalibration(live.imageCalibration, live.rawData);
    console.log("APPLIED to live calibration.");
  } else console.log("dry-run; --apply to write");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
