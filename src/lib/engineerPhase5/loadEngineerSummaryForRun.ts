import { prisma } from "@/lib/prisma";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { buildEngineerRunSummary, type RunShapeForEngineer } from "@/lib/engineerPhase5/buildEngineerRunSummary";
import { computeFieldImportSessionFromSets } from "@/lib/lapField/fieldImportSession";
import { hasTeammateLink } from "@/lib/teammateRunAccess";

const runSelect = {
  id: true,
  createdAt: true,
  lapTimes: true,
  lapSession: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  handlingAssessmentJson: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carId: true,
  importedLapTimeSessionId: true,
  engineerSummaryJson: true,
  engineerSummaryRefRunId: true,
  setupSnapshot: { select: { data: true } },
  importedLapSets: {
    select: {
      id: true,
      driverName: true,
      displayName: true,
      isPrimaryUser: true,
      laps: {
        select: { lapNumber: true, lapTimeSeconds: true, isIncluded: true },
        orderBy: { lapNumber: "asc" as const },
      },
    },
  },
} as const;

/** Stable string so cached summary invalidates when imported lap sets or lap rows change. */
function fieldFingerprint(
  sets: Array<{
    id: string;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }>
): string {
  if (sets.length === 0) return "";
  return [...sets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => {
      const lapSig = [...s.laps]
        .sort((a, b) => a.lapNumber - b.lapNumber)
        .map((l) => `${l.lapNumber}:${l.lapTimeSeconds}:${l.isIncluded}`)
        .join(",");
      return `${s.id}:${lapSig}`;
    })
    .join("|");
}

function toShape(
  r: {
    id: string;
    createdAt: Date;
    lapTimes: unknown;
    lapSession: unknown;
    notes: string | null;
    driverNotes: string | null;
    handlingProblems: string | null;
    handlingAssessmentJson: unknown;
    sessionType: string;
    meetingSessionType: string | null;
    meetingSessionCode: string | null;
    sessionLabel: string | null;
    carId: string | null;
    setupSnapshot: { data: unknown } | null;
  }
): RunShapeForEngineer {
  return {
    id: r.id,
    createdAt: r.createdAt,
    lapTimes: r.lapTimes,
    lapSession: r.lapSession ?? undefined,
    notes: r.notes,
    driverNotes: r.driverNotes,
    handlingProblems: r.handlingProblems,
    handlingAssessmentJson: r.handlingAssessmentJson,
    sessionType: r.sessionType,
    meetingSessionType: r.meetingSessionType,
    meetingSessionCode: r.meetingSessionCode,
    sessionLabel: r.sessionLabel,
    carId: r.carId,
    setupSnapshot: r.setupSnapshot,
  };
}

export async function getOrComputeEngineerSummaryForRun(
  userId: string,
  runId: string,
  opts?: { force?: boolean }
): Promise<{ summary: EngineerRunSummaryV2; cached: boolean } | null> {
  const run = await prisma.run.findFirst({
    where: { id: runId, userId },
    select: runSelect,
  });
  if (!run) return null;

  const reference = run.carId
    ? await prisma.run.findFirst({
        where: { userId, carId: run.carId, id: { not: run.id } },
        orderBy: { createdAt: "desc" },
        select: runSelect,
      })
    : null;

  const refId = reference?.id ?? null;
  const fp = fieldFingerprint(run.importedLapSets ?? []);
  if (
    !opts?.force &&
    run.engineerSummaryJson &&
    typeof run.engineerSummaryJson === "object" &&
    run.engineerSummaryRefRunId === refId
  ) {
    const cached = run.engineerSummaryJson as EngineerRunSummaryV2;
    if (cached.fieldFingerprint === fp) {
      return { summary: cached, cached: true };
    }
  }

  const importedSession = run.importedLapTimeSessionId
    ? await prisma.importedLapTimeSession.findFirst({
        where: { id: run.importedLapTimeSessionId, userId },
        select: { sourceUrl: true, eventDetectionSessionLabel: true },
      })
    : null;

  const fieldImportSession =
    computeFieldImportSessionFromSets(
      (run.importedLapSets ?? []).map((s) => ({
        driverName: s.driverName,
        displayName: s.displayName,
        isPrimaryUser: s.isPrimaryUser,
        laps: s.laps.map((l) => ({
          lapNumber: l.lapNumber,
          lapTimeSeconds: l.lapTimeSeconds,
          isIncluded: l.isIncluded,
        })),
      }))
    ) ?? null;

  const summary = await buildEngineerRunSummary({
    current: toShape(run),
    reference: reference ? toShape(reference) : null,
    importedSession: importedSession,
    fieldImportSession,
    fieldFingerprint: fp,
  });

  await prisma.run.update({
    where: { id: runId },
    data: {
      engineerSummaryJson: summary as object,
      engineerSummaryRefRunId: refId,
      engineerSummaryComputedAt: new Date(),
    },
  });

  return { summary, cached: false };
}

const runSelectWithOwner = {
  ...runSelect,
  userId: true,
} as const;

/**
 * Compare an explicit pair of runs (primary must be the viewer's; compare may be a linked teammate's).
 * Does not persist to `Run.engineerSummaryJson` (pair selection is ephemeral in the UI).
 */
export async function getOrComputeEngineerSummaryForRunPair(
  viewerUserId: string,
  primaryRunId: string,
  compareRunId: string
): Promise<{ summary: EngineerRunSummaryV2 } | null> {
  if (primaryRunId === compareRunId) return null;

  const primary = await prisma.run.findFirst({
    where: { id: primaryRunId, userId: viewerUserId },
    select: runSelect,
  });
  if (!primary) return null;

  const compare = await prisma.run.findFirst({
    where: { id: compareRunId },
    select: runSelectWithOwner,
  });
  if (!compare) return null;

  if (compare.userId !== viewerUserId) {
    const ok = await hasTeammateLink(viewerUserId, compare.userId);
    if (!ok) return null;
  }

  const { userId: _uid, ...compareForShape } = compare;

  const importedSession = primary.importedLapTimeSessionId
    ? await prisma.importedLapTimeSession.findFirst({
        where: { id: primary.importedLapTimeSessionId, userId: viewerUserId },
        select: { sourceUrl: true, eventDetectionSessionLabel: true },
      })
    : null;

  const fp = fieldFingerprint(primary.importedLapSets ?? []);
  const fieldImportSession =
    computeFieldImportSessionFromSets(
      (primary.importedLapSets ?? []).map((s) => ({
        driverName: s.driverName,
        displayName: s.displayName,
        isPrimaryUser: s.isPrimaryUser,
        laps: s.laps.map((l) => ({
          lapNumber: l.lapNumber,
          lapTimeSeconds: l.lapTimeSeconds,
          isIncluded: l.isIncluded,
        })),
      }))
    ) ?? null;

  const summary = await buildEngineerRunSummary({
    current: toShape(primary),
    reference: toShape(compareForShape),
    importedSession: importedSession,
    fieldImportSession,
    fieldFingerprint: fp,
  });

  return { summary };
}
