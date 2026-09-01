import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";

async function main() {
  const dir = path.resolve("public/uploads/setup-documents");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".pdf")).slice(-8);
  for (const f of files) {
    try {
      const ex = await extractPdfFormFields(Buffer.from(await readFile(path.join(dir, f))));
      const names = new Set(ex.fields.map((x) => x.name));
      const oldMarks = ["Texte2", "Text12", "Check Box48"].filter((n) => names.has(n)).length;
      const newMarks = ["Front Camber", "Front Shock Oil"].filter((n) => names.has(n)).length;
      const filled = ex.fields.filter((x) => x.value?.trim()).length;
      console.log(`${f}: fields=${ex.fields.length} old-layout-marks=${oldMarks} new-layout-marks=${newMarks} filledValues=${filled}`);
    } catch (e) {
      console.log(`${f}: unreadable (${(e as Error).message.slice(0, 80)})`);
    }
  }
}

main();
