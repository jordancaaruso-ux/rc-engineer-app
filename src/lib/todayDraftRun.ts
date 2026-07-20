import { prisma } from "@/lib/prisma";
import { todayBoundsInTimeZone } from "@/lib/eventActive";

export type TodayDraftRun = {
  id: string;
  /** ISO instant when the draft was first saved (run `createdAt`). */
  savedAt: string;
};

/**
 * Latest incomplete run logged today, if any. "Today" is the calendar day in
 * the USER's IANA `timeZone` (from the `rc_tz` cookie) — never the server's:
 * Vercel runs in UTC, so server-local bounds would roll the day at 10am AEST
 * and silently drop a morning draft from the Finish-run CTA/FAB.
 */
export async function getTodayDraftRun(
  userId: string,
  timeZone: string
): Promise<TodayDraftRun | null> {
  const { start, end } = todayBoundsInTimeZone(timeZone);
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
