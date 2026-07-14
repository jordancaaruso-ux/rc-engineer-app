/** Read a real (non-gold) jpg through the converged mirror pipeline; print all values. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration, readImageThroughCalibration } from "./mtc3-common";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
async function main() {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const live = await loadLiveCalibration();
  const img = readFileSync(arg("img")!);
  const read = await readImageThroughCalibration(img, live.imageCalibration, apiKey);
  const keys = Object.keys(read.parsedData).sort();
  for (const k of keys) console.log(`${k.padEnd(28)} ${JSON.stringify(read.parsedData[k])}`);
  console.log(`\n${keys.length} values read`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
