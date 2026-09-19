import { PrismaClient } from "@prisma/client";
async function main() {
  const prisma = new PrismaClient();
  const u = await prisma.user.findFirst({ where: { email: "jordancaaruso@gmail.com" }, select: { id: true } });
  const r = await prisma.run.findFirst({
    where: { userId: u!.id, sessionCompletedAt: { gte: new Date("2026-07-19T16:00:00Z"), lte: new Date("2026-07-19T18:00:00Z") } },
    orderBy: { sortAt: "desc" }, select: { id: true, sessionCompletedAt: true },
  });
  console.log(r?.id ?? "none", r?.sessionCompletedAt?.toISOString());
  await prisma.$disconnect();
}
main();
