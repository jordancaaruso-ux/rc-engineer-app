import { PrismaClient } from "@prisma/client";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { PDFDocument, PDFName, PDFTextField } from "pdf-lib";

/** What appearance instructions the BLANK's own fields carry, before we touch anything. */
const prisma = new PrismaClient();

async function main() {
  const blankId = process.argv[2]!;
  const blank = await prisma.setupSheetBlank.findUniqueOrThrow({
    where: { id: blankId },
    select: { isEdition: true, setupDocument: { select: { storagePath: true, originalFilename: true } } },
  });
  const bytes = await readBytesFromStorageRef(blank.setupDocument!.storagePath);
  const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
  const form = doc.getForm();
  const formDa = (form.acroForm.dict.lookup(PDFName.of("DA")) as { asString?: () => string } | undefined)?.asString?.();
  console.log(`${blank.setupDocument!.originalFilename} edition=${blank.isEdition}`);
  console.log(`form DA: ${formDa}`);
  const tally = new Map<string, number>();
  let text = 0;
  for (const f of form.getFields()) {
    if (!(f instanceof PDFTextField)) continue;
    text += 1;
    const da = (f.acroField.getDefaultAppearance() ?? "(inherits)").replace(/\s+/g, " ").trim();
    tally.set(da, (tally.get(da) ?? 0) + 1);
  }
  console.log(`${text} text fields; distinct DA strings:`);
  for (const [da, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${n.toString().padStart(3)} x  ${da}`);
  }
}
main().finally(() => prisma.$disconnect());
