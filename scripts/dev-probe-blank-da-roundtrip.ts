import { PrismaClient } from "@prisma/client";
import { PDFDocument, PDFName, PDFTextField } from "pdf-lib";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { blankPdfFormValues } from "@/lib/setupDocuments/pdfBlankForm";

/** Does the sheet's own /DA survive the blanking step? */
const prisma = new PrismaClient();

function daTally(doc: PDFDocument): Map<string, number> {
  const tally = new Map<string, number>();
  for (const f of doc.getForm().getFields()) {
    if (!(f instanceof PDFTextField)) continue;
    const field = (f.acroField.getDefaultAppearance() ?? "(none)").replace(/\s+/g, " ").trim();
    const widget = f.acroField.getWidgets()[0]?.dict.lookup(PDFName.of("DA"));
    const w = widget ? (widget as { asString?: () => string }).asString?.() ?? "?" : "(none)";
    const key = `field=${field} | widget=${w.replace(/\s+/g, " ").trim()}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return tally;
}

async function main() {
  const blank = await prisma.setupSheetBlank.findUniqueOrThrow({
    where: { id: process.argv[2]! },
    select: { setupDocument: { select: { storagePath: true } } },
  });
  const raw = await readBytesFromStorageRef(blank.setupDocument!.storagePath);

  const before = await PDFDocument.load(new Uint8Array(raw), { ignoreEncryption: true });
  console.log("BEFORE:");
  for (const [k, n] of [...daTally(before)].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`  ${n} x ${k}`);

  const blanked = await blankPdfFormValues(new Uint8Array(raw));
  const after = await PDFDocument.load(blanked, { ignoreEncryption: true });
  console.log("AFTER blanking:");
  for (const [k, n] of [...daTally(after)].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`  ${n} x ${k}`);
}
main().finally(() => prisma.$disconnect());
