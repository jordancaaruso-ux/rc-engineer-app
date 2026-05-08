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
 * Choose a reference run chronologically before `current` for Engineer pairwise summaries.
 * Prefers same track + tire conditions before falling back to "previous on car" by time.
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
      trackId: true,
      tireSetId: true,
      tireRunNumber: true,
    },
    take: 500,
    orderBy: { createdAt: "desc" },
  });

  const before = peers.filter((p) => sortMs(p) < tCur);
  before.sort((a, b) => sortMs(b) - sortMs(a));

  const first = (pred: (r: (typeof before)[number]) => boolean) => before.find(pred);

  if (current.trackId && current.tireSetId) {
    const r = first(
      (c) =>
        c.trackId === current.trackId &&
        c.tireSetId === current.tireSetId &&
        c.tireRunNumber === current.tireRunNumber
    );
    if (r) return r.id;
  }
  if (current.trackId) {
    const r = first(
      (c) => c.trackId === current.trackId && c.tireRunNumber === current.tireRunNumber
    );
    if (r) return r.id;
  }
  if (current.trackId) {
    const r = first((c) => c.trackId === current.trackId);
    if (r) return r.id;
  }
  return before[0]?.id ?? null;
}
