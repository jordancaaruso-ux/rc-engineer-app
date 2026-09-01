import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { PDFDocument } from "pdf-lib";
import { sheetOwnFonts, bakeValueAppearances } from "@/lib/setupDocuments/pdfValueAppearances";
import { fillPdfForm } from "@/lib/setupDocuments/fillPdfForm";

/** Dev rig: run the own-font bake straight over a blank, with no route or cache in the way. */
const prisma = new PrismaClient();

async function main() {
  const drive = process.argv[3]!;
  const blank = await prisma.setupSheetBlank.findUniqueOrThrow({
    where: { id: process.argv[2]! },
    select: { setupDocument: { select: { storagePath: true } } },
  });
  const bytes = await readBytesFromStorageRef(blank.setupDocument!.storagePath);

  const probe = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
  const fonts = sheetOwnFonts(probe);
  console.log(`fonts with widths: ${[...fonts.keys()].join(", ") || "(none)"}`);

  // A handful of real field names off this blank, with values that stress the size rule.
  const form = probe.getForm();
  const names = form.getFields().map((f) => f.getName());
  const picks = ["ratio", "spur", "pinion", "Front Upper Hub Spacer"].filter((n) => names.includes(n));
  const mappings = Object.fromEntries(picks.map((n) => [n, { pdfFieldName: n }]));
  const values = { ratio: "7.4643", spur: "110", pinion: "28", "Front Upper Hub Spacer": "2.25" };

  const filled = await fillPdfForm({ blank: new Uint8Array(bytes), mappings, values });
  const out = await PDFDocument.load(filled.bytes, { ignoreEncryption: true });
  const bake = await bakeValueAppearances(out, out.getForm(), undefined);
  console.log(`re-bake over the filled file would handle ${bake.handled.size} fields / ${bake.widgets} widgets`);

  await writeFile(`${drive}/probe-own-font.pdf`, filled.bytes);
  console.log(`wrote probe-own-font.pdf (${filled.bytes.length} bytes), written=${filled.written}`);
}
main().finally(() => prisma.$disconnect());
