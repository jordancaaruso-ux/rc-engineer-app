import "server-only";

import { prisma } from "@/lib/prisma";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
import { primaryNormsFromImportedLapSets } from "@/lib/lapImport/importedTimingFieldStatsForEngineer";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";
import { normalizeLapTimes } from "@/lib/runLaps";
import {
  canViewPeerRuns,
  isRunSharedWithTeam,
  peerAccessIsTeamOnly,
} from "@/lib/teammateRunAccess";

/**
 * The full field of a run's imported timing session (e.g. a LiveRC race
 * result), for the run-detail driver-compare pager: every entrant's laps in
 * race-classification order, with the logging user's row flagged.
 */

export type RaceFieldDriver = {
  /** Stable per-session driver id from the timing provider. */
  id: string;
  name: string;
  /** 1-based classification position (laps desc, total time asc). */
  position: number;
  isUser: boolean;
  laps: number[];
};

export type RaceFieldForRun = {
  /** ≥2 entries when a multi-driver session is linked; empty otherwise. */
  drivers: RaceFieldDriver[];
};

function lapsTotal(laps: number[]): number {
  let sum = 0;
  for (const t of laps) sum += t;
  return sum;
}

/** Two lap arrays match when equal length and every lap agrees to the ms. */
function lapsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 0.0005) return false;
  }
  return true;
}

/**
 * Resolve the run's linked imported timing session and return every driver
 * with laps, in classification order (most laps, then lowest total time —
 * reconstructs race finish order; penalties applied off-track are invisible).
 * Returns an empty field when the run has no linked session or the session
 * has fewer than two drivers with laps.
 */
export async function loadRaceFieldForRun(viewerId: string, runId: string): Promise<RaceFieldForRun> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      userId: true,
      shareWithTeam: true,
      lapTimes: true,
      importedLapTimeSessionId: true,
      importedLapSets: { select: { driverName: true, isPrimaryUser: true } },
      linkedImportedLapSessions: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, parsedPayload: true },
      },
    },
  });
  if (!run) return { drivers: [] };

  // Authorize the viewer against the run's OWNER, not themselves: the field is
  // scoped to whoever logged the run. Teammates see it via link / mutual team;
  // team-only access additionally requires the run be shared with the team.
  const ownerId = run.userId;
  if (ownerId !== viewerId) {
    if (!(await canViewPeerRuns(viewerId, ownerId))) return { drivers: [] };
    if ((await peerAccessIsTeamOnly(viewerId, ownerId)) && !isRunSharedWithTeam(run)) {
      return { drivers: [] };
    }
  }

  // Prefer the detection-primary session; fall back to the newest linked one
  // whose payload actually carries a multi-driver field.
  const candidates: Array<{ id: string; parsedPayload: unknown }> = [];
  if (run.importedLapTimeSessionId) {
    const detected = await prisma.importedLapTimeSession.findFirst({
      where: { id: run.importedLapTimeSessionId, userId: ownerId },
      select: { id: true, parsedPayload: true },
    });
    if (detected) candidates.push(detected);
  }
  for (const linked of run.linkedImportedLapSessions) {
    if (!candidates.some((c) => c.id === linked.id)) candidates.push(linked);
  }

  let field: ReturnType<typeof rawSessionDriversFromImportedPayload> = null;
  for (const candidate of candidates) {
    const drivers = rawSessionDriversFromImportedPayload(candidate.parsedPayload);
    const withLaps = drivers?.filter((d) => d.laps.length > 0) ?? [];
    if (withLaps.length >= 2) {
      field = withLaps;
      break;
    }
  }
  if (!field) return { drivers: [] };

  // Classification order: most laps first, total time breaks ties.
  const ordered = [...field].sort(
    (a, b) => b.laps.length - a.laps.length || lapsTotal(a.laps) - lapsTotal(b.laps)
  );

  // The user's row: saved primary lap-set name first, then exact lap match,
  // then the parser convention that the primary driver is stored first.
  const primaryNorms = primaryNormsFromImportedLapSets(run.importedLapSets);
  const runLaps = normalizeLapTimes(run.lapTimes);
  let userDriverId: string | null = null;
  if (primaryNorms.length > 0) {
    const byName = ordered.find((d) => {
      const n = normalizeLiveRcDriverNameForMatch(d.driverName);
      return primaryNorms.some((p) => p === n || p === d.normalizedName);
    });
    if (byName) userDriverId = byName.id;
  }
  if (!userDriverId && runLaps.length > 0) {
    const byLaps = ordered.find((d) => lapsEqual(d.laps, runLaps));
    if (byLaps) userDriverId = byLaps.id;
  }
  if (!userDriverId) userDriverId = field[0]?.id ?? null;

  return {
    drivers: ordered.map((d, i) => ({
      id: d.id,
      name: d.driverName,
      position: i + 1,
      isUser: d.id === userDriverId,
      laps: d.laps,
    })),
  };
}
