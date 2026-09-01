import { readFile, writeFile } from "node:fs/promises";
import { PDFDict, PDFDocument, PDFName, PDFString, PDFTextField } from "pdf-lib";

/**
 * Probe: put the blank's OWN appearance instruction back on a filled sheet and see what a viewer
 * makes of it. The blank says `/Verdana,Italic 0 Tf 1 0 0 rg`; our export writes `/Helvetica 10`.
 */
async function main() {
  const drive = process.argv[2]!;
  const doc = await PDFDocument.load(new Uint8Array(await readFile(`${drive}/downloaded.pdf`)), {
    ignoreEncryption: true,
  });
  const form = doc.getForm();
  const DA = "/Verdana,Italic 0 Tf 1 0 0 rg";
  let fields = 0;
  let widgets = 0;
  for (const f of form.getFields()) {
    if (!(f instanceof PDFTextField) || !f.getText()) continue;
    f.acroField.dict.set(PDFName.of("DA"), PDFString.of(DA));
    fields += 1;
    for (const w of f.acroField.getWidgets()) {
      const d = w.dict as PDFDict;
      if (d.lookup(PDFName.of("DA"))) {
        d.set(PDFName.of("DA"), PDFString.of(DA));
        widgets += 1;
      }
      // Drop the baked picture so the viewer must redraw from the instruction above.
      d.delete(PDFName.of("AP"));
    }
  }
  await writeFile(`${drive}/variant-own-da.pdf`, await doc.save({ updateFieldAppearances: false }));
  console.log(`restored DA on ${fields} fields / ${widgets} widgets`);
}
main();
