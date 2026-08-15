/**
 * Cars, most recently USED first — the ordering every car list should default to.
 *
 * Two tiers, and the split is the point:
 *
 *   1. Cars that have been RUN, most recent run first.
 *   2. Cars that have never been run, most recently added first.
 *
 * The list used to be plain `orderBy: { createdAt: "desc" }`, which never moves again once a car
 * is added — so the car every run in the app belongs to sat under chassis added later and never
 * driven. The obvious repair, `max(last run, added)`, is not enough on real data: measured on the
 * founder's own rows (2026-08-15), FOUR never-run cars had been added more recently than his last
 * run on the car he drives exclusively, so they all still outranked it. Adding a car is a minute's
 * work; running one is a weekend. They are not the same signal and must not share an axis.
 *
 * The cost is one case: the first run on a brand-new car, where that car sits below the ones you
 * already drive instead of on top. It jumps to first the moment that run is logged, and a driver's
 * FIRST car is unaffected (nothing to rank it against).
 *
 * Run rows are written when the driver logs the session, which is at the track, so `run.createdAt`
 * stands in for "when this car was last out". It is also the only timestamp always present —
 * `sessionCompletedAt` only exists on runs that came from a timing import.
 *
 * Timestamps are passed as epoch milliseconds rather than `Date`s because one caller reads them
 * back out of `unstable_cache`, which round-trips through JSON and would hand a `Date` field back
 * as a string.
 */
export function orderCarsByRecentUse<T extends { id: string }>(
  cars: readonly T[],
  /** Car id → epoch ms of that car's most recent run. Missing = never run. */
  lastRunAtMsByCarId: ReadonlyMap<string, number>,
  createdAtMs: (car: T) => number
): T[] {
  const rank = (car: T) => {
    const lastRun = lastRunAtMsByCarId.get(car.id);
    return lastRun ? { driven: 1, at: lastRun } : { driven: 0, at: createdAtMs(car) || 0 };
  };
  // Stable sort, so cars that tie (two never-run cars created in the same millisecond) keep the
  // order the query gave them rather than shuffling between loads.
  return [...cars].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return rb.driven - ra.driven || rb.at - ra.at;
  });
}

/**
 * `prisma.run.groupBy({ by: ["carId"], _max: { createdAt: true } })` rows → the map above.
 * `carId` is nullable on Run (a deleted car sets it null); those rows belong to no car and are
 * dropped rather than colliding on an empty-string key.
 */
export function lastRunAtMsByCarId(
  rows: readonly { carId: string | null; _max: { createdAt: Date | null } }[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (!row.carId) continue;
    const at = row._max.createdAt;
    if (at) out.set(row.carId, at.getTime());
  }
  return out;
}
