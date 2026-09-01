import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const snap = await prisma.setupSnapshot.findUniqueOrThrow({
    where: { id: process.argv[2]! },
    select: {
      id: true, carId: true, name: true, isLibrary: true, sheetBlankId: true, createdAt: true,
      data: true,
      runs: { select: { id: true }, take: 1 },
    },
  });
  const data = snap.data as Record<string, unknown>;
  console.log(`snapshot ${snap.id} car=${snap.carId} library=${snap.isLibrary} name=${snap.name} blank=${snap.sheetBlankId}`);
  console.log(`chassis = ${JSON.stringify(data.chassis)}`);
  console.log(`run: ${snap.runs[0]?.id ?? "-"} | setup page: /cars/${snap.carId}/setups/${snap.id}`);
}

main().finally(() => prisma.$disconnect());
