import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";

async function show(label: string, file: string, names: string[]) {
  const bytes = await readFile(file);
  const ex = await extractPdfFormFields(Buffer.from(bytes));
  for (const name of names) {
    const f = ex.fields.find((x) => x.name === name);
    if (!f) { console.log(`${label} ${name}: NOT FOUND`); continue; }
    for (const w of f.widgets) {
      console.log(`${label} ${name}#${w.instanceIndex}: x=${w.x.toFixed(2)} y=${w.y.toFixed(2)} w=${w.width.toFixed(1)} h=${w.height.toFixed(1)}`);
    }
  }
}

async function main() {
  await show("OLD", path.resolve("public/setup-sheets/A800RR.pdf"), ["Check Box17"]);
  await show("NEW", path.resolve("scripts/tmp-lucas-setup2.pdf"), ["Chassis"]);
}

main();
