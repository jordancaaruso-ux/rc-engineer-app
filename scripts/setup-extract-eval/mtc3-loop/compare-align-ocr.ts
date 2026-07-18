/**
 * Full read of case-01 vs a padded variant — every field must agree (alignment proof for OCR too).
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-extract-eval/mtc3-loop/compare-align-ocr.ts
 *   --pad=padded/pad-asymmetric.jpg
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration, readImageThroughCalibration } from "./mtc3-common";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const live = await loadLiveCalibration();
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const dir = join(process.cwd(), "scripts/setup-extract-eval/mtc3-loop/cases");
  const base = readFileSync(join(dir, "case-01.jpg"));
  const padPath = arg("pad") ?? "padded/pad-asymmetric.jpg";
  const padded = readFileSync(join(dir, padPath));

  console.log("Reading base case-01…");
  const a = await readImageThroughCalibration(base, live.imageCalibration, apiKey);
  console.log("Reading", padPath, "…");
  const b = await readImageThroughCalibration(padded, live.imageCalibration, apiKey);

  const keys = new Set([...Object.keys(a.parsedData), ...Object.keys(b.parsedData)]);
  let mism = 0;
  for (const k of [...keys].sort()) {
    const av = JSON.stringify(a.parsedData[k] ?? "");
    const bv = JSON.stringify(b.parsedData[k] ?? "");
    if (av !== bv) {
      mism++;
      console.log(`DIFF ${k}: base=${av} pad=${bv}`);
    }
  }
  console.log(`\n${keys.size - mism}/${keys.size} fields agree (${mism} diffs)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
