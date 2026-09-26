import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Of `ids`, the additives some driver other than `userId` has on a run or a meeting entry — the
 * Additives page's bulk form of `additiveTypeUsedByOthers` (`@/lib/assets/catalogUsage`), which
 * the API checks one row at a time. Same two relations, so the page never offers Edit or Delete
 * that the API then refuses. One groupBy per relation, not one query per row.
 */
export async function additiveIdsUsedByOthers(ids: string[], userId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [runs, participations] = await Promise.all([
    prisma.run.groupBy({
      by: ["additiveTypeId"],
      where: { additiveTypeId: { in: ids }, userId: { not: userId } },
    }),
    prisma.eventParticipation.groupBy({
      by: ["controlledAdditiveTypeId"],
      where: { controlledAdditiveTypeId: { in: ids }, userId: { not: userId } },
    }),
  ]);
  const used = new Set<string>();
  for (const r of runs) if (r.additiveTypeId) used.add(r.additiveTypeId);
  for (const p of participations) if (p.controlledAdditiveTypeId) used.add(p.controlledAdditiveTypeId);
  return used;
}
