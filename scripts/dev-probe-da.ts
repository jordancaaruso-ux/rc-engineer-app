import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, PDFTextField } from "pdf-lib";

/** What appearance instructions the fields actually carry. */
async function main() {
  const bytes = await readFile(process.argv[2]!);
  const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
  const form = doc.getForm();
  const da = form.acroForm.dict.lookup(PDFName.of("DA")) as { asString?: () => string } | undefined;
  console.log("form DA:", da?.asString?.());
  let shown = 0;
  for (const f of form.getFields()) {
    if (!(f instanceof PDFTextField) || !f.getText()) continue;
    console.log(`${f.getName()}: DA=${f.acroField.getDefaultAppearance() ?? "(none)"} | text=${f.getText()}`);
    if (++shown >= 8) break;
  }
}
main();
