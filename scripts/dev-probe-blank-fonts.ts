import { PrismaClient } from "@prisma/client";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";

/**
 * Dev rig for the "why doesn't the export look like the screen" question: does the chassis blank
 * carry the font its fields name, or only reference it by name?
 */
const prisma = new PrismaClient();

async function main() {
  const snap = await prisma.setupSnapshot.findUniqueOrThrow({
    where: { id: "cmthx2yi400s8vlckug9pnrvr" },
    select: { sheetBlankId: true },
  });
  const blank = await prisma.setupSheetBlank.findUniqueOrThrow({
    where: { id: snap.sheetBlankId! },
    select: { setupDocument: { select: { storagePath: true, originalFilename: true } } },
  });
  const bytes = await readBytesFromStorageRef(blank.setupDocument!.storagePath);
  const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
  const form = doc.getForm();
  const dr = form.acroForm.dict.lookup(PDFName.of("DR")) as PDFDict | undefined;
  const fonts = dr?.lookup(PDFName.of("Font")) as PDFDict | undefined;
  console.log(`blank: ${blank.setupDocument!.originalFilename}`);
  if (!fonts) return console.log("no /DR /Font at all");
  for (const [name] of fonts.entries()) {
    const f = fonts.lookup(name) as PDFDict;
    const base = f.lookup(PDFName.of("BaseFont"))?.toString();
    const desc = f.lookup(PDFName.of("FontDescriptor")) as PDFDict | undefined;
    const embedded = desc
      ? ["FontFile", "FontFile2", "FontFile3"].filter((k) => desc.lookup(PDFName.of(k)))
      : [];
    console.log(`  ${name.toString()} base=${base} embedded=${embedded.join(",") || "NO"}`);
  }
}
main().finally(() => prisma.$disconnect());
