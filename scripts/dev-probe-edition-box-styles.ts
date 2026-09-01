import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** What the on-screen sheet plan says about a few boxes' styles, for the edition blank. */
async function main() {
  const snap = await prisma.setupSnapshot.findUniqueOrThrow({
    where: { id: "cmthx2yi400s8vlckug9pnrvr" },
    select: { sheetBlankId: true },
  });
  const blank = await prisma.setupSheetBlank.findUniqueOrThrow({
    where: { id: snap.sheetBlankId! },
    select: { id: true, isEdition: true, boxesJson: true },
  });
  const boxes = blank.boxesJson as Array<Record<string, unknown>>;
  console.log(`blank ${blank.id} edition=${blank.isEdition} boxes=${boxes.length}`);
  for (const key of ["ratio", "camber_front", "name", "track"]) {
    const hits = boxes.filter((b) => String(b.key ?? b.fieldKey ?? "").includes(key)).slice(0, 2);
    for (const h of hits) console.log(key, "->", JSON.stringify(h).slice(0, 380));
  }
}
main().finally(() => prisma.$disconnect());
