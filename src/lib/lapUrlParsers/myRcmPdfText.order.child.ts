/**
 * Child process for `myRcmPdfText.order.test.ts` — runs the two pdf.js copies in the order
 * given on the command line and prints one line. Not a test on its own; the test spawns it
 * once per order because pdf.js caches its worker per PROCESS, so two orders cannot share one.
 *
 *   node --conditions=react-server --import tsx <this file> sheet,laps,sheet
 */

import fs from "node:fs";
import { extractMyRcmPdfCells } from "@/lib/lapUrlParsers/myRcmPdfText";
import { pdf } from "pdf-to-img";

const FIXTURE = "src/lib/lapUrlParsers/__fixtures__/myrcm-pdf-final-startrow.pdf";

async function laps(): Promise<string> {
  const cells = await extractMyRcmPdfCells(new Uint8Array(fs.readFileSync(FIXTURE)));
  return `laps:${cells.length}`;
}

async function sheet(): Promise<string> {
  const doc = await pdf(fs.readFileSync(FIXTURE), { scale: 0.1 });
  const png = await doc.getPage(1);
  await doc.destroy();
  return `sheet:${png.length > 0 ? "ok" : "empty"}`;
}

async function main(): Promise<void> {
  const order = (process.argv[2] ?? "").split(",").filter(Boolean);
  const out: string[] = [];
  for (const step of order) out.push(await (step === "laps" ? laps() : sheet()));
  console.log(out.join(" "));
}

main().catch((error: unknown) => {
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
