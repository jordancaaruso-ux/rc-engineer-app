/**
 * Run lists used for comparison. Today: my_runs only.
 * Later: team_runs, shared_setups, etc. can extend the catalog shape.
 */
export type RunCompareListSource = "my_runs" | "team_runs";

export function compareRunTimestamp(a: { createdAt: Date | string }, b: { createdAt: Date | string }) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/** Next older run in a newest-first list. */
export function findPreviousInOrderedList<T extends { id: string }>(
  runsNewestFirst: T[],
  currentId: string
): T | null {
  const i = runsNewestFirst.findIndex((r) => r.id === currentId);
  if (i < 0 || i >= runsNewestFirst.length - 1) return null;
  return runsNewestFirst[i + 1] ?? null;
}

export function findPreviousSameCar<T extends { id: string; carId: string | null }>(
  runsNewestFirst: T[],
  currentId: string,
  carId: string | null
): T | null {
  if (!carId) return null;
  const sameCar = runsNewestFirst.filter((r) => r.carId === carId);
  return findPreviousInOrderedList(sameCar, currentId);
}
