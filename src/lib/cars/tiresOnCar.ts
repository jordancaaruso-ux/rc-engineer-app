/**
 * The tires a car has run, for the car page's "Tires on this car" card: each compound once, how
 * many runs it was on, and the furthest run number it was taken to.
 *
 * A run counts ONCE per compound. A front/rear run with the same compound at both ends ran that
 * compound on one run, not two. Counting each end on its own made one run on Hole Shot front and
 * rear read "Hole Shot — 2 runs" on a car with one run (test drive, 2026-09-26). How far the
 * compound was taken still reads both ends, since the front set can be on a later run than the rear.
 *
 * On a front/rear run the un-prefixed tire columns are the REAR (see `runTireEnds.ts`). A run's
 * compound is on the run itself OR on the tire set it was logged with.
 *
 * Pure: no Prisma, no React.
 */

export type TireRunRow = {
  tireTypeId: string | null;
  tireRunNumber: number;
  tireType: { displayName: string } | null;
  frontTireTypeId: string | null;
  frontTireRunNumber: number | null;
  frontTireType: { displayName: string } | null;
  tireSet: { tireTypeId: string | null; tireType: { displayName: string } | null } | null;
};

export type TireOnCar = {
  id: string;
  label: string;
  /** Runs this compound was on, each run once. */
  runCount: number;
  /** Highest run number reached on this compound — a rough "how far you've taken it". */
  furthestRun: number;
};

export function tiresOnCar(rows: readonly TireRunRow[]): TireOnCar[] {
  const byId = new Map<string, TireOnCar>();
  for (const r of rows) {
    const ends = [
      {
        id: r.tireTypeId ?? r.tireSet?.tireTypeId ?? null,
        label: r.tireType?.displayName ?? r.tireSet?.tireType?.displayName ?? "Tires",
        runNumber: r.tireRunNumber,
      },
      {
        id: r.frontTireTypeId,
        label: r.frontTireType?.displayName ?? "Tires",
        runNumber: r.frontTireRunNumber ?? 1,
      },
    ];
    const countedThisRun = new Set<string>();
    for (const end of ends) {
      if (!end.id) continue;
      const tire = byId.get(end.id) ?? { id: end.id, label: end.label, runCount: 0, furthestRun: 0 };
      if (!countedThisRun.has(end.id)) {
        tire.runCount += 1;
        countedThisRun.add(end.id);
      }
      tire.furthestRun = Math.max(tire.furthestRun, end.runNumber);
      byId.set(end.id, tire);
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}
