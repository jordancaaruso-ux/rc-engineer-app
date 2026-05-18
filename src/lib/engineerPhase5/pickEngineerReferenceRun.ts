import { prisma } from "@/lib/prisma";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";

type CurrentForReferencePick = {
  id: string;
  carId: string | null;
  trackId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
  createdAt: Date;
  sessionCompletedAt: Date | null;
};

function sortMs(run: { createdAt: Date; sessionCompletedAt: Date | null }): number {
  return resolveRunDisplayInstant({
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt,
  }).getTime();
}

/**
 * Choose the reference run for Engineer pairwise summaries: the **most recent other run
 * on the same car** that is strictly **before** `current` in time (`createdAt` /
 * `sessionCompletedAt` via {@link resolveRunDisplayInstant}).
 *
 * This intentionally ignores track / tire matching so "what changed recently" always
 * means **last session vs this session** on that car, not a same-venue heuristic.
 */
export async function pickEngineerReferenceRunId(
  userId: string,
  current: CurrentForReferencePick,
  opts?: { loggingCompleteOnly?: boolean }
): Promise<string | null> {
  if (!current.carId) return null;
  const tCur = sortMs(current);

  const peers = await prisma.run.findMany({
    where: {
      userId,
      carId: current.carId,
      id: { not: current.id },
      ...(opts?.loggingCompleteOnly ? { loggingComplete: true } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
    },
    take: 500,
    orderBy: { createdAt: "desc" },
  });

  const before = peers.filter((p) => sortMs(p) < tCur);
  before.sort((a, b) => sortMs(b) - sortMs(a));

  return before[0]?.id ?? null;
}
