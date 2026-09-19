import { PrismaClient } from "@prisma/client";
async function main() {
  const prisma = new PrismaClient();
  const u = await prisma.user.findFirst({ where: { email: "jordancaaruso@gmail.com" }, select: { id: true } });
  const cars = await prisma.car.findMany({
    where: { userId: u!.id },
    select: { id: true, name: true, chassis: true, setupSheetModelId: true,
      setupSheetModel: { select: { name: true } }, _count: { select: { runs: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const c of cars)
    console.log(`${String(c._count.runs).padStart(4)} runs  ${c.name} | chassis=${c.chassis ?? "—"} | model=${c.setupSheetModel?.name ?? "—"} (${c.setupSheetModelId ?? "none"})`);
  await prisma.$disconnect();
}
main();
