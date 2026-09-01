import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PDFDocument, PDFName, PDFTextField } from "pdf-lib";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { blankPdfFormValues } from "@/lib/setupDocuments/pdfBlankForm";
import { sheetOwnFonts } from "@/lib/setupDocuments/pdfValueAppearances";

/** Dev rig: what the own-font path finds on EVERY chassis blank in the database. */
const prisma = new PrismaClient();

async function main() {
  const blanks = await prisma.setupSheetBlank.findMany({
    where: { setupDocument: { isNot: null } },
    select: {
      id: true,
      isEdition: true,
      setupSheetModel: { select: { name: true } },
      setupDocument: { select: { storagePath: true } },
    },
    take: 25,
  });
  for (const b of blanks) {
    try {
      const raw = await readBytesFromStorageRef(b.setupDocument!.storagePath);
      const blanked = await blankPdfFormValues(new Uint8Array(raw));
      const doc = await PDFDocument.load(blanked, { ignoreEncryption: true });
      const fonts = sheetOwnFonts(doc);
      const tally = new Map<string, number>();
      for (const f of doc.getForm().getFields()) {
        if (!(f instanceof PDFTextField)) continue;
        const da = f.acroField.getDefaultAppearance() ?? "(none)";
        const name = /\/([^\s]+)\s+[\d.]+\s+Tf/.exec(da)?.[1] ?? "(none)";
        tally.set(name, (tally.get(name) ?? 0) + 1);
      }
      const named = [...tally].sort((a, b2) => b2[1] - a[1]).slice(0, 3);
      const usable = named.filter(([n]) => fonts.has(n)).reduce((s, [, n]) => s + n, 0);
      const total = [...tally.values()].reduce((s, n) => s + n, 0);
      console.log(
        `${(b.setupSheetModel?.name ?? "?").padEnd(22)} ed=${b.isEdition ? "y" : "n"} | own-font ${usable}/${total} | DA: ${named.map(([n, c]) => `${n}x${c}`).join(" ")}`
      );
    } catch (e) {
      console.log(`${b.setupSheetModel?.name ?? "?"}: FAILED ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
