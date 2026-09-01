import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const model = await prisma.setupSheetModel.findFirstOrThrow({
    where: { slug: "awesomatix_a800rr" },
    select: { id: true },
  });
  const blanks = await prisma.setupSheetBlank.findMany({
    where: { setupSheetModelId: model.id, status: "FILLABLE" },
    select: { id: true, isEdition: true, boxesJson: true },
  });
  for (const b of blanks) {
    const boxes = (b.boxesJson as Array<{ key: string; optionValue?: string }>) ?? [];
    const chassis = boxes.filter((x) => x.key === "chassis");
    console.log(`${b.isEdition ? "EDITION" : "PRIMARY"} ${b.id}: chassis boxes → ${chassis.map((c) => JSON.stringify(c.optionValue)).join(", ")}`);
  }
}

main().finally(() => prisma.$disconnect());
