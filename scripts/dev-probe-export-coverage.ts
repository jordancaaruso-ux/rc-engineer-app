import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PDFDocument, PDFName, PDFTextField } from "pdf-lib";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { blankPdfFormValues } from "@/lib/setupDocuments/pdfBlankForm";
import { fillPdfForm } from "@/lib/setupDocuments/fillPdfForm";
import { bakeValueAppearances } from "@/lib/setupDocuments/pdfValueAppearances";

/**
 * Dev rig: fill EVERY chassis blank with a stress value and report how each one is drawn.
 *
 * The stress value is deliberately long for the box, because a fixed stated size is what clipped
 * `7.4643` to `4643` — a sheet that draws it whole is a sheet whose size rule is the app's.
 */
const prisma = new PrismaClient();

async function main() {
  const drive = process.argv[2]!;
  const blanks = await prisma.setupSheetBlank.findMany({
    where: { setupDocument: { isNot: null } },
    select: {
      id: true,
      isEdition: true,
      setupSheetModel: { select: { name: true } },
      setupDocument: { select: { storagePath: true } },
    },
  });

  for (const b of blanks) {
    const label = `${b.setupSheetModel?.name ?? "?"}${b.isEdition ? " (edition)" : ""}`;
    try {
      const raw = await readBytesFromStorageRef(b.setupDocument!.storagePath);
      const blanked = await blankPdfFormValues(new Uint8Array(raw));

      // Every single-line text field on the sheet, filled with the same stress value.
      const probe = await PDFDocument.load(blanked, { ignoreEncryption: true });
      const names = probe
        .getForm()
        .getFields()
        .filter((f): f is PDFTextField => f instanceof PDFTextField)
        .map((f) => f.getName());
      const mappings = Object.fromEntries(names.map((n) => [n, { pdfFieldName: n }]));
      const values = Object.fromEntries(names.map((n) => [n, "7.4643"]));

      const filled = await fillPdfForm({ blank: blanked, mappings, values });
      const out = await PDFDocument.load(filled.bytes, { ignoreEncryption: true });
      // Re-run the engine over the result purely to count how each field WOULD be drawn.
      const bake = await bakeValueAppearances(out, out.getForm(), undefined);

      // Did any widget keep pdf-lib's rewritten instruction?
      let clobbered = 0;
      for (const f of out.getForm().getFields()) {
        if (!(f instanceof PDFTextField)) continue;
        for (const w of f.acroField.getWidgets()) {
          const da = w.dict.lookup(PDFName.of("DA")) as { asString?: () => string } | undefined;
          if (da?.asString?.().includes("/Helvetica ")) clobbered += 1;
        }
      }

      console.log(
        `${label.padEnd(26)} drawn ${String(bake.widgets).padStart(3)} ` +
          `(sheet font ${String(bake.withSheetFont).padStart(3)}, standard ${String(bake.withStandardFont).padStart(3)}) ` +
          `| widgets left saying /Helvetica: ${clobbered}`
      );
      if (/Xray X4'26/.test(label)) await writeFile(`${drive}/xray-export.pdf`, filled.bytes);
    } catch (e) {
      console.log(`${label.padEnd(26)} FAILED ${e instanceof Error ? e.message.slice(0, 70) : e}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
