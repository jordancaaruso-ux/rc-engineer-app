import { buildDriverDataBlocks } from "@/lib/engineer/driverData";
import { prisma } from "@/lib/prisma";
import { runLocalDayKey } from "@/lib/runs/buildRunHistoryGroups";

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "jordancaaruso@gmail.com" },
    select: { id: true },
  });
  if (!user) throw new Error("no user");

  // A day with several runs, so the day block has something to show.
  const runs = await prisma.run.findMany({
    where: { userId: user.id, loggingComplete: true },
    orderBy: { sortAt: "desc" },
    take: 400,
    select: { id: true, createdAt: true, sortAt: true, localTimeZone: true, carId: true },
  });
  const byDay = new Map<string, typeof runs>();
  for (const r of runs) {
    const k = runLocalDayKey(r);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  const good = [...byDay.entries()].filter(([, rs]) => rs.length >= 3).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
  const targets: Array<[string, string | null]> = [
    ["LATEST RUN", null],
    [`MOST RECENT MULTI-RUN DAY (${good[0]}, ${good[1].length} runs)`, good[1][0].id],
  ];

  for (const [label, runId] of targets) {
    console.log(`\n############ ${label} ############`);
    const blocks = await buildDriverDataBlocks({ userId: user.id, runId });
    const total = blocks.reduce((n, b) => n + b.content.length, 0);
    for (const b of blocks) console.log(b.content);
    console.log(`\n---- ${total} chars ----`);
  }
  await prisma.$disconnect();
}
main();
