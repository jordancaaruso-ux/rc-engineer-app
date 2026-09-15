import "server-only";

import { prisma } from "@/lib/prisma";
import { fieldPaceFromStats, type FieldPace } from "@/lib/engineer/fieldPace";
import { importedSessionFieldStatsV1FromJson, primaryNormsFromImportedLapSets } from "@/lib/lapImport/importedTimingFieldStatsForEngineer";
import { normalizeLapTimes } from "@/lib/runLaps";

/**
 * The field for each run, from the timing sessions the app already linked to it: the
 * detection-primary session first, then the newest linked ones — the race-field view's own
 * order. Stored field stats only; a session imported before stats existed is the backfill
 * script's job (`npm run db:backfill-field-stats`), not a read-time recompute over every
 * entrant's laps.
 */
export type FieldRunInput = {
  id: string;
  lapTimes: unknown;
  importedLapTimeSessionId: string | null;
  importedLapSets: Array<{ driverName: string; isPrimaryUser: boolean }>;
  linkedImportedLapSessions: Array<{ id: string; fieldStatsJson: unknown }>;
};

/** The relation shape to put in a Prisma `select` so a run row satisfies FieldRunInput. */
export const FIELD_RUN_SELECT = {
  importedLapTimeSessionId: true,
  importedLapSets: { select: { driverName: true, isPrimaryUser: true } },
  linkedImportedLapSessions: {
    orderBy: { createdAt: "desc" as const },
    take: 3,
    select: { id: true, fieldStatsJson: true },
  },
} as const;

export async function loadFieldPaceForRuns(
  userId: string,
  runs: ReadonlyArray<FieldRunInput>
): Promise<Map<string, FieldPace>> {
  const out = new Map<string, FieldPace>();
  if (runs.length === 0) return out;

  // Detection-primary sessions are not a relation on Run; one batched read for all of them.
  const detectedIds = [...new Set(runs.map((r) => r.importedLapTimeSessionId).filter((id): id is string => !!id))];
  const detected = detectedIds.length
    ? await prisma.importedLapTimeSession
        .findMany({ where: { id: { in: detectedIds }, userId }, select: { id: true, fieldStatsJson: true } })
        .catch(() => [])
    : [];
  const detectedById = new Map(detected.map((s) => [s.id, s.fieldStatsJson]));

  for (const run of runs) {
    const candidates: unknown[] = [];
    if (run.importedLapTimeSessionId && detectedById.has(run.importedLapTimeSessionId)) {
      candidates.push(detectedById.get(run.importedLapTimeSessionId));
    }
    for (const s of run.linkedImportedLapSessions) {
      if (s.id !== run.importedLapTimeSessionId) candidates.push(s.fieldStatsJson);
    }
    const norms = primaryNormsFromImportedLapSets(run.importedLapSets);
    const laps = normalizeLapTimes(run.lapTimes);
    for (const raw of candidates) {
      const stats = importedSessionFieldStatsV1FromJson(raw);
      if (!stats) continue;
      const pace = fieldPaceFromStats(stats, norms, laps);
      if (pace) {
        out.set(run.id, pace);
        break;
      }
    }
  }
  return out;
}
