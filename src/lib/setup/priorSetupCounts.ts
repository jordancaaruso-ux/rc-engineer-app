import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * How many setups each car already has to start a new one from.
 *
 * Counts every `SetupSnapshot` on the car, because all three kinds are equally good starting
 * points and they share one table: setups the driver kept (`isLibrary`), the setup a run was
 * logged on, and one read out of an uploaded sheet. That is exactly the list
 * `/cars/[carId]/setups/new` offers, so this count and that list can never disagree about whether
 * there is anything to pick.
 *
 * Baselines are NOT in here. They are global, published against the chassis rather than the car,
 * and already counted by `baselineCountsByModelId` — the "start from something" door adds the two.
 */
export async function priorSetupCountsByCarId(
  userId: string,
  carIds: readonly string[]
): Promise<Map<string, number>> {
  const ids = carIds.filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await prisma.setupSnapshot.groupBy({
    by: ["carId"],
    where: { userId, carId: { in: [...ids] } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.carId ?? "", r._count._all]));
}
