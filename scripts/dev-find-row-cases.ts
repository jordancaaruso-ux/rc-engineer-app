import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Dev rig: setup pages that exercise each shape of the action row. */
async function main() {
  const email = "jordancaaruso@gmail.com";
  const withRunAndDoc = await prisma.setupSnapshot.findFirst({
    where: { user: { email }, sourceDocuments: { some: {} }, runs: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, carId: true },
  });
  const sheetless = await prisma.setupSnapshot.findFirst({
    where: { user: { email }, car: { setupSheetModelId: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, carId: true, car: { select: { name: true } } },
  });
  console.log(
    `run+doc: ${withRunAndDoc ? `cars/${withRunAndDoc.carId}/setups/${withRunAndDoc.id}` : "none"}`
  );
  console.log(
    `sheetless (${sheetless?.car?.name ?? "-"}): ${sheetless ? `cars/${sheetless.carId}/setups/${sheetless.id}` : "none"}`
  );
}

main().finally(() => prisma.$disconnect());
