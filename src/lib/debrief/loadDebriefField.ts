import "server-only";

import { prisma } from "@/lib/prisma";
import { FIELD_RUN_SELECT, loadFieldPaceForRuns } from "@/lib/engineer/fieldPaceLoad";

/**
 * Your top 5 against the field's median top 5, for every run whose timing sheet had other
 * drivers on it and named you — the figures behind the debrief's "vs field" line. Negative is
 * quicker than the middle of the field (you minus them, the app's sign).
 *
 * The same stored sheet figures and the same maths the Engineer reads (`loadFieldPaceForRuns`),
 * with one difference: when your saved driver name doesn't pick you out, the run has no field
 * here. The Engineer falls back to "the first stored driver is you", and on the founder's own
 * sheets that was the heat winner on 6 of 51 heats (probe 2026-09-15).
 *
 * One read for the linked sheets of the runs that have any (the rest never come back), one inside
 * the loader for the detection-primary sheets. Always scoped to `userId`: the debrief is the
 * driver's own.
 */
export async function loadDebriefFieldGaps(
  userId: string,
  runs: ReadonlyArray<{
    id: string;
    lapTimes: unknown;
    importedLapSets: ReadonlyArray<{ driverName: string; isPrimaryUser: boolean }>;
  }>
): Promise<Map<string, number>> {
  const gaps = new Map<string, number>();
  if (runs.length === 0) return gaps;

  const sheets = await prisma.run.findMany({
    where: {
      id: { in: runs.map((run) => run.id) },
      userId,
      OR: [{ importedLapTimeSessionId: { not: null } }, { linkedImportedLapSessions: { some: {} } }],
    },
    select: {
      id: true,
      importedLapTimeSessionId: true,
      linkedImportedLapSessions: FIELD_RUN_SELECT.linkedImportedLapSessions,
    },
  });
  if (sheets.length === 0) return gaps;

  const runById = new Map(runs.map((run) => [run.id, run]));
  const inputs = sheets.flatMap((sheet) => {
    const run = runById.get(sheet.id);
    if (!run) return [];
    return [
      {
        id: run.id,
        lapTimes: run.lapTimes,
        importedLapSets: [...run.importedLapSets],
        importedLapTimeSessionId: sheet.importedLapTimeSessionId,
        linkedImportedLapSessions: sheet.linkedImportedLapSessions,
      },
    ];
  });

  const paces = await loadFieldPaceForRuns(userId, inputs, { guessFirstDriver: false });
  for (const [runId, pace] of paces) {
    if (pace.gapTop5ToMedian != null && Number.isFinite(pace.gapTop5ToMedian)) {
      gaps.set(runId, pace.gapTop5ToMedian);
    }
  }
  return gaps;
}
