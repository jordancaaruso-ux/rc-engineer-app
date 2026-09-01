import { readFile, writeFile } from "node:fs/promises";
import { PDFBool, PDFDocument, PDFName } from "pdf-lib";

/** Flatten but KEEP the appearances already in the file (manufacturer marks + baked text). */
async function main() {
  const drive = process.argv[2]!;
  const bytes = await readFile(`${drive}/downloaded.pdf`);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.False);
  form.flatten({ updateFieldAppearances: false });
  await writeFile(`${drive}/variant-flat-keep.pdf`, await doc.save());
  console.log("C: flat-keep saved");
}
main();
