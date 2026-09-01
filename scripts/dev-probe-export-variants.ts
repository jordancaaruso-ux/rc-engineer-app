import { readFile, writeFile } from "node:fs/promises";
import { PDFBool, PDFDocument, PDFName } from "pdf-lib";

/** Dev rig: two candidate export shapes from an already-filled sheet, to eyeball in Chrome. */
async function main() {
  const drive = process.argv[2]!;
  const bytes = await readFile(`${drive}/downloaded.pdf`);

  // Variant A: NeedAppearances off — viewers show the baked appearances instead of redrawing.
  {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    doc.getForm().acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.False);
    await writeFile(`${drive}/variant-noredraw.pdf`, await doc.save({ updateFieldAppearances: false }));
    console.log("A: noredraw saved");
  }

  // Variant B: flattened — appearances burnt into the page, fields removed.
  {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = doc.getForm();
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.False);
    try {
      form.flatten();
      console.log("B: flatten() worked");
    } catch (e) {
      console.log("B: flatten() threw:", e instanceof Error ? e.message.slice(0, 120) : e);
      return;
    }
    await writeFile(`${drive}/variant-flat.pdf`, await doc.save());
    console.log("B: flat saved");
  }
}
main();

/** Variant C: flatten but KEEP the appearances already in the file (manufacturer marks + baked text). */
export async function variantC(drive: string) {
  const bytes = await readFile(`${drive}/downloaded.pdf`);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.False);
  form.flatten({ updateFieldAppearances: false });
  await writeFile(`${drive}/variant-flat-keep.pdf`, await doc.save());
  console.log("C: flat-keep saved");
}
