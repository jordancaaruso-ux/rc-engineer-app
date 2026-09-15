import "server-only";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getLiveRcDriverIdSetting, getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { importedSessionInstantToReal } from "@/lib/runSessionCompletedAt";
import { buildRunLapMaterial } from "@/lib/runs/importedSessionLapMaterial";
import { writeRunImportedLapSets } from "@/lib/runs/writeRunImportedLapSets";

export type AttachSessionStatus =
  | "attached"
  | "run_not_found"
  | "run_has_laps"
  | "session_not_found"
  | "already_linked"
  | "no_time"
  | "no_laps";

/**
 * Put a timing session's laps on a run the driver opened themselves — a draft, or a logged run
 * saved without laps. The draft stays a draft: the driver still closes it (feel, notes, save).
 * `lapsAttachedBySweepAt` marks that the app did this; the undo is the existing "not my session"
 * unlink (`DELETE /api/runs/[id]/lap-import`), which clears the mark with the laps.
 *
 * The claim on the session row is inside the transaction, the same guard `createBackfilledRuns`
 * uses, so a tick and a wizard save racing for one session cannot both win.
 */
export async function attachSessionToClaimant(params: {
  userId: string;
  runId: string;
  importedLapTimeSessionId: string;
  /** Zone to read a wall-clock timing site in — the run's own, else the track's. */
  zone: string | null;
}): Promise<{ status: AttachSessionStatus; instant?: Date }> {
  const run = await prisma.run.findFirst({
    where: { id: params.runId, userId: params.userId },
    select: {
      id: true,
      eventId: true,
      localTimeZone: true,
      lapTimes: true,
      importedLapTimeSessionId: true,
    },
  });
  if (!run) return { status: "run_not_found" };
  const hasLaps = Array.isArray(run.lapTimes) && run.lapTimes.length > 0;
  if (hasLaps || run.importedLapTimeSessionId) return { status: "run_has_laps" };

  const session = await prisma.importedLapTimeSession.findFirst({
    where: { id: params.importedLapTimeSessionId, userId: params.userId },
    select: {
      id: true,
      sourceUrl: true,
      parserId: true,
      parsedPayload: true,
      sessionCompletedAt: true,
      linkedRunId: true,
      createdAt: true,
    },
  });
  if (!session) return { status: "session_not_found" };
  if (session.linkedRunId) return { status: "already_linked" };

  const rawIso =
    session.sessionCompletedAt?.toISOString() ??
    sessionCompletedAtIsoFromImportedPayload(session.parsedPayload);
  if (!rawIso) return { status: "no_time" };
  const zone = run.localTimeZone ?? params.zone ?? null;
  const instant = importedSessionInstantToReal(new Date(rawIso), session.sourceUrl, zone);

  const [liveRcDriverName, liveRcDriverId] = await Promise.all([
    getLiveRcDriverNameSetting(params.userId),
    getLiveRcDriverIdSetting(params.userId),
  ]);
  const material = buildRunLapMaterial(session, {
    liveRcDriverId,
    liveRcDriverName,
    eventId: run.eventId,
  });
  if (!material) return { status: "no_laps" };

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.importedLapTimeSession.updateMany({
        where: { id: session.id, userId: params.userId, linkedRunId: null },
        data: { linkedRunId: run.id },
      });
      if (claimed.count !== 1) throw new SessionAlreadyClaimed();
      await tx.runImportedLap.deleteMany({ where: { lapSet: { runId: run.id } } });
      await tx.runImportedLapSet.deleteMany({ where: { runId: run.id } });
      await writeRunImportedLapSets(tx, run.id, material.lapSets);
      await tx.run.update({
        where: { id: run.id },
        data: {
          lapTimes: material.lapTimes,
          lapSession: material.lapSession as unknown as PrismaTypes.InputJsonValue,
          bestLapSeconds: material.lapSummary.bestLapSeconds,
          avgTop5LapSeconds: material.lapSummary.avgTop5LapSeconds,
          sessionCompletedAt: instant,
          importedLapTimeSessionId: session.id,
          lapsAttachedBySweepAt: now,
        },
      });
    });
  } catch (err) {
    const unique = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (err instanceof SessionAlreadyClaimed || unique) return { status: "already_linked" };
    throw err;
  }
  return { status: "attached", instant };
}

class SessionAlreadyClaimed extends Error {
  constructor() {
    super("imported lap session already linked to a run");
  }
}
