import { prisma } from "@/lib/prisma";
import { startOfLocalDay } from "@/lib/eventActive";

function localTodayBounds(): { start: Date; end: Date } {
  const start = startOfLocalDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export type TodayDraftRun = {
  id: string;
  /** ISO instant when the draft was first saved (run `createdAt`). */
  savedAt: string;
};

/** Latest incomplete run logged today (local calendar day), if any. */
export async function getTodayDraftRun(userId: string): Promise<TodayDraftRun | null> {
  const { start, end } = localTodayBounds();
  const runs = await prisma.run.findMany({
    where: {
      userId,
      createdAt: { gte: start, lt: end },
    },
    orderBy: { sortAt: "asc" },
    select: { id: true, createdAt: true, loggingComplete: true },
  });
  const draft = [...runs].reverse().find((r) => r.loggingComplete === false);
  if (!draft) return null;
  return { id: draft.id, savedAt: draft.createdAt.toISOString() };
}

/** @deprecated Prefer {@link getTodayDraftRun}. */
export async function getTodayDraftRunId(userId: string): Promise<string | null> {
  const draft = await getTodayDraftRun(userId);
  return draft?.id ?? null;
}
