import { prisma } from "@/lib/prisma";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { buildEngineerRunSummary, type RunShapeForEngineer } from "@/lib/engineerPhase5/buildEngineerRunSummary";

const runSelect = {
  id: true,
  createdAt: true,
  lapTimes: true,
  lapSession: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carId: true,
  importedLapTimeSessionId: true,
  engineerSummaryJson: true,
  engineerSummaryRefRunId: true,
  setupSnapshot: { select: { data: true } },
} as const;

function toShape(
  r: {
    id: string;
    createdAt: Date;
    lapTimes: unknown;
    lapSession: unknown;
    notes: string | null;
    driverNotes: string | null;
    handlingProblems: string | null;
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
  if (
    !opts?.force &&
    run.engineerSummaryJson &&
    typeof run.engineerSummaryJson === "object" &&
    run.engineerSummaryRefRunId === refId
  ) {
    return { summary: run.engineerSummaryJson as EngineerRunSummaryV2, cached: true };
  }

  const importedSession = run.importedLapTimeSessionId
    ? await prisma.importedLapTimeSession.findFirst({
        where: { id: run.importedLapTimeSessionId, userId },
        select: { sourceUrl: true, eventDetectionSessionLabel: true },
      })
    : null;

  const summary = await buildEngineerRunSummary({
    current: toShape(run),
    reference: reference ? toShape(reference) : null,
    importedSession: importedSession,
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
