import { readFile, writeFile } from "node:fs/promises";
import { renderPdfPageToPng } from "@/lib/setupDocuments/pdfServerRaster";

/** Dev rig: rasterise a PDF the way the app's viewer does, to eyeball an export. */
async function main() {
  const src = process.argv[2]!;
  const out = process.argv[3]!;
  const bytes = await readFile(src);
  const png = await renderPdfPageToPng(new Uint8Array(bytes), 1, { scale: 2 });
  await writeFile(out, png);
  console.log("rendered", png.length, "bytes ->", out);
}
main();
