import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * How many baselines exist for each chassis, in one query for a whole list of cars.
 *
 * The "Create / Upload setup sheet" panel offers **start from a baseline** as a permanent door, and
 * a door has to say whether it can work before it is opened. Counting per car row would fan out one
 * query per car on the garage hub, so the counts arrive together.
 *
 * Baselines are GLOBAL — published against a chassis, not owned by a driver — so this is never
 * scoped by userId. A baseline somebody else published is one this driver may start from.
 */
export async function baselineCountsByModelId(
  modelIds: ReadonlyArray<string | null>
): Promise<Map<string, number>> {
  const ids = [...new Set(modelIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();

  const rows = await prisma.baselineSetup.groupBy({
    by: ["setupSheetModelId"],
    where: { setupSheetModelId: { in: ids } },
    _count: { _all: true },
  });

  return new Map(rows.map((r) => [r.setupSheetModelId, r._count._all]));
}
