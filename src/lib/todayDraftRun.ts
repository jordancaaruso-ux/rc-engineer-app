import { prisma } from "@/lib/prisma";
import { startOfLocalDay } from "@/lib/eventActive";

function localTodayBounds(): { start: Date; end: Date } {
  const start = startOfLocalDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Latest incomplete run logged today (local calendar day), if any. */
export async function getTodayDraftRunId(userId: string): Promise<string | null> {
  const { start, end } = localTodayBounds();
  const runs = await prisma.run.findMany({
    where: {
      userId,
      createdAt: { gte: start, lt: end },
    },
    orderBy: { sortAt: "asc" },
    select: { id: true, loggingComplete: true },
  });
  return [...runs].reverse().find((r) => r.loggingComplete === false)?.id ?? null;
}
