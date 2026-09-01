import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cars = await prisma.car.findMany({
    where: { user: { email: "jordancaaruso@gmail.com" } },
    select: {
      id: true, name: true,
      setupSheetModel: { select: { name: true, slug: true } },
      _count: { select: { runs: true } },
    },
  });
  for (const c of cars) {
    console.log(`${c.id} | ${c.name} | chassis=${c.setupSheetModel?.slug ?? "-"} | runs=${c._count.runs}`);
  }
}

main().finally(() => prisma.$disconnect());
