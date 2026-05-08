import { prisma } from "@/lib/prisma";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { buildEngineerRunSummary, type RunShapeForEngineer } from "@/lib/engineerPhase5/buildEngineerRunSummary";
import { computeFieldImportSessionFromSets } from "@/lib/lapField/fieldImportSession";
import {
  combinedEngineerFieldFingerprint,
  resolveImportedTimingFieldStatsForEngineer,
} from "@/lib/lapImport/importedTimingFieldStatsForEngineer";
import { canViewPeerRuns, isRunSharedWithTeam, peerAccessIsTeamOnly } from "@/lib/teammateRunAccess";
import { pickEngineerReferenceRunId } from "@/lib/engineerPhase5/pickEngineerReferenceRun";

const runSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  trackId: true,
  tireSetId: true,
  tireRunNumber: true,
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

function normalizeCachedSummaryJson(raw: EngineerRunSummaryV2): EngineerRunSummaryV2 {
  return {
    ...raw,
    importedSessionFieldStats: raw.importedSessionFieldStats ?? null,
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

  let reference: (typeof run) | null = null;
  if (run.carId) {
    const refId = await pickEngineerReferenceRunId(userId, {
      id: run.id,
      carId: run.carId,
      trackId: run.trackId,
      tireSetId: run.tireSetId,
      tireRunNumber: run.tireRunNumber,
      createdAt: run.createdAt,
      sessionCompletedAt: run.sessionCompletedAt,
    });
    if (refId) {
      reference = await prisma.run.findFirst({
        where: { id: refId, userId },
        select: runSelect,
      });
    }
  }

  const refId = reference?.id ?? null;
  const lapSetFp = fieldFingerprint(run.importedLapSets ?? []);
  const lapsForImportedFieldMatch = (run.importedLapSets ?? []).map((s) => ({
    driverName: s.driverName,
    isPrimaryUser: s.isPrimaryUser,
  }));
  let importedSessionFieldCompact: EngineerRunSummaryV2["importedSessionFieldStats"] = null;
  let sessionFingerToken = "";
  if (run.importedLapTimeSessionId) {
    const r = await resolveImportedTimingFieldStatsForEngineer({
      userId,
      importedLapTimeSessionId: run.importedLapTimeSessionId,
      importedLapSetsForMatch: lapsForImportedFieldMatch,
    });
    importedSessionFieldCompact = r.compact;
    sessionFingerToken = r.fingerprintToken;
  }
  const fp = combinedEngineerFieldFingerprint(lapSetFp, sessionFingerToken);
  if (
    !opts?.force &&
    run.engineerSummaryJson &&
    typeof run.engineerSummaryJson === "object" &&
    run.engineerSummaryRefRunId === refId
  ) {
    const cached = run.engineerSummaryJson as EngineerRunSummaryV2;
    if (cached.fieldFingerprint === fp) {
      return { summary: normalizeCachedSummaryJson(cached), cached: true };
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
    importedSessionFieldStats: importedSessionFieldCompact,
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
  shareWithTeam: true,
} as const;

/**
 * Compare an explicit pair of runs (primary must be the viewer's; compare may be a peer via TeammateLink or mutual team).
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
    const ok = await canViewPeerRuns(viewerUserId, compare.userId);
    if (!ok) return null;
    if (
      (await peerAccessIsTeamOnly(viewerUserId, compare.userId)) &&
      !isRunSharedWithTeam(compare)
    ) {
      return null;
    }
  }

  const { userId: _uid, ...compareForShape } = compare;

  const importedSession = primary.importedLapTimeSessionId
    ? await prisma.importedLapTimeSession.findFirst({
        where: { id: primary.importedLapTimeSessionId, userId: viewerUserId },
        select: { sourceUrl: true, eventDetectionSessionLabel: true },
      })
    : null;

  let importedSessionFieldCompact: EngineerRunSummaryV2["importedSessionFieldStats"] = null;
  let sessionFingerToken = "";
  if (primary.importedLapTimeSessionId) {
    const r = await resolveImportedTimingFieldStatsForEngineer({
      userId: viewerUserId,
      importedLapTimeSessionId: primary.importedLapTimeSessionId,
      importedLapSetsForMatch: (primary.importedLapSets ?? []).map((s) => ({
        driverName: s.driverName,
        isPrimaryUser: s.isPrimaryUser,
      })),
    });
    importedSessionFieldCompact = r.compact;
    sessionFingerToken = r.fingerprintToken;
  }
  const lapSetFp = fieldFingerprint(primary.importedLapSets ?? []);
  const fp = combinedEngineerFieldFingerprint(lapSetFp, sessionFingerToken);
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
    importedSessionFieldStats: importedSessionFieldCompact,
    fieldFingerprint: fp,
  });

  return { summary };
}
