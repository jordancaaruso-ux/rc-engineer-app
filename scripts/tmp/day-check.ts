import { PrismaClient } from "@prisma/client";
import { runLocalDayKey } from "@/lib/runs/buildRunHistoryGroups";
async function main() {
  const prisma = new PrismaClient();
  const u = await prisma.user.findFirst({ where: { email: "jordancaaruso@gmail.com" }, select: { id: true } });
  const runs = await prisma.run.findMany({
    where: { userId: u!.id },
    orderBy: { sortAt: "asc" },
    select: { id: true, createdAt: true, sortAt: true, sessionCompletedAt: true, localTimeZone: true, carId: true, loggingComplete: true },
  });
  const target = runs.filter((r) => runLocalDayKey(r) === "2026-04-20");
  console.log("runs whose LOCAL DAY KEY is 2026-04-20:", target.length);
  for (const r of target)
    console.log(`  sortAt=${r.sortAt.toISOString().slice(0, 16)}  session=${(r.sessionCompletedAt ?? r.createdAt).toISOString().slice(0, 16)}  car=${r.carId?.slice(-6)}  complete=${r.loggingComplete}`);
  const span = target.length ? (Math.max(...target.map((r) => r.sortAt.getTime())) - Math.min(...target.map((r) => r.sortAt.getTime()))) / 3600000 : 0;
  console.log("sortAt span across that day:", span.toFixed(1), "hours (my window is +/-40h)");
  await prisma.$disconnect();
}
main();
