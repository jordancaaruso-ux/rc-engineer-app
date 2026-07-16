/** Compare every GROUP value: new Otsu mirror read vs the production parsedDataJson (old gap read). */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration, readImageThroughCalibration } from "./mtc3-common";

const DOC = "cmrlh9xdr0001jr04ne9axz0s";
const IMG = "scripts/setup-extract-eval/gold/mugen-mtc3/files/img4248-real.jpeg";

async function main() {
  const live = await loadLiveCalibration();
  const doc = await prisma.setupDocument.findUnique({ where: { id: DOC }, select: { parsedDataJson: true } });
  const old = (doc?.parsedDataJson ?? {}) as Record<string, unknown>;
  const read = await readImageThroughCalibration(readFileSync(IMG), live.imageCalibration, "", { skipOcr: true });
  const groupKeys = Object.keys(read.groupDetail ?? {});
  let changed = 0;
  for (const k of groupKeys.sort()) {
    const now = read.parsedData[k] ?? "(blank)";
    const before = old[k] != null ? String(old[k]) : "(blank)";
    const nowS = String(now);
    if (nowS !== before) { changed++; console.log(`CHANGED ${k.padEnd(24)} old=${before.padEnd(16)} new=${nowS}`); }
  }
  console.log(`\n${groupKeys.length} group fields, ${changed} changed vs production.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
