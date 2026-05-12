import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getOrComputeEngineerSummaryForRun,
  getOrComputeEngineerSummaryForRunPair,
} from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import { computeBetweenRunSignals } from "@/lib/engineerPhase5/betweenRunHints/computeBetweenRunSignals";
import { buildBetweenRunHintFingerprint } from "@/lib/engineerPhase5/betweenRunHints/buildBetweenRunHintFingerprint";
import { buildRecentSessionsForBetweenHints } from "@/lib/engineerPhase5/betweenRunHints/buildRecentSessionsForBetweenHints";
import { pickHintContextReferenceRun } from "@/lib/engineerPhase5/betweenRunHints/pickHintContextReferenceRun";
import { buildHintSessionBrief } from "@/lib/engineerPhase5/betweenRunHints/buildHintSessionBrief";
import { buildPairwiseSetupDigestForHints } from "@/lib/engineerPhase5/betweenRunHints/pairwiseSetupDigestForHints";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import type {
  BetweenRunHintPayloadV2,
  BetweenRunHintScopeV1,
  BetweenRunHintSignal,
  RecentSessionsFingerprintMaterial,
} from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import type { HintBaselineProvenance } from "@/lib/engineerPhase5/betweenRunHints/pickHintContextReferenceRun";

function clampText(s: string | null | undefined, max: number): string | null {
  const t = s?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function buildTireContextLine(
  primary: { tireSetId: string | null; tireRunNumber: number },
  chrono: { tireSetId: string | null; tireRunNumber: number } | null
): string | null {
  if (!primary.tireSetId) return null;
  if (!chrono?.tireSetId) {
    return `Linked tire set — this outing is run #${primary.tireRunNumber} on the set.`;
  }
  if (chrono.tireSetId === primary.tireSetId) {
    return `Same tire set as your immediate prior outing on this car: prior #${chrono.tireRunNumber} → this session #${primary.tireRunNumber}.`;
  }
  return `This session is run #${primary.tireRunNumber} on the linked tire set (your prior outing used a different set).`;
}

async function loadScopeForPrimaryRun(
  userId: string,
  primaryRunId: string
): Promise<BetweenRunHintScopeV1 | null> {
  const run = await prisma.run.findFirst({
    where: { id: primaryRunId, userId },
    select: {
      carId: true,
      car: { select: { id: true, name: true } },
      track: { select: { id: true, name: true } },
      event: { select: { id: true, name: true } },
    },
  });
  if (!run?.carId || !run.car) return null;
  return {
    eventId: run.event?.id ?? null,
    eventLabel: run.event?.name ?? null,
    carId: run.car.id,
    carLabel: run.car.name,
    trackId: run.track?.id ?? null,
    trackLabel: run.track?.name ?? null,
  };
}

export type PreparedBetweenRunHintComputation = {
  scope: BetweenRunHintScopeV1;
  engineerSummary: EngineerRunSummaryV2;
  hintSummary: EngineerRunSummaryV2;
  provenance: HintBaselineProvenance | null;
  runMeta: {
    handlingAssessmentJson: unknown;
    handlingProblems: string | null;
    suggestedChanges: string | null;
    suggestedPreRun: string | null;
    notes: string | null;
    driverNotes: string | null;
    tireSetId: string | null;
    tireRunNumber: number;
    id: string;
    carId: string;
    trackId: string | null;
    eventId: string | null;
    createdAt: Date;
    sessionCompletedAt: Date | null;
    sortAt: Date;
  };
  recentSessions: BetweenRunHintPayloadV2["recentSessions"];
  fingerprintMaterial: RecentSessionsFingerprintMaterial;
  driverContextPack: BetweenRunHintPayloadV2["driverContextPack"];
  fp: string;
  signals: BetweenRunHintSignal[];
};

export async function prepareBetweenRunHintComputation(
  userId: string,
  primaryRunId: string,
  opts?: { forceEngineerSummary?: boolean }
): Promise<PreparedBetweenRunHintComputation | null> {
  const scope = await loadScopeForPrimaryRun(userId, primaryRunId);
  if (!scope) return null;

  const summaryResult = await getOrComputeEngineerSummaryForRun(userId, primaryRunId, {
    force: Boolean(opts?.forceEngineerSummary),
  });
  if (!summaryResult?.summary) return null;

  const engineerSummary = summaryResult.summary;
  const engineerRef = engineerSummary.referenceRunId;

  const runMetaRow = await prisma.run.findFirst({
    where: { id: primaryRunId, userId },
    select: {
      id: true,
      carId: true,
      trackId: true,
      eventId: true,
      createdAt: true,
      sessionCompletedAt: true,
      sortAt: true,
      handlingAssessmentJson: true,
      handlingProblems: true,
      suggestedChanges: true,
      suggestedPreRun: true,
      notes: true,
      driverNotes: true,
      tireSetId: true,
      tireRunNumber: true,
    },
  });
  if (!runMetaRow?.carId) return null;

  const runMeta: PreparedBetweenRunHintComputation["runMeta"] = {
    ...runMetaRow,
    carId: runMetaRow.carId,
  };

  const pick = await pickHintContextReferenceRun(
    userId,
    {
      id: runMeta.id,
      carId: runMeta.carId,
      trackId: runMeta.trackId,
      eventId: runMeta.eventId,
      tireSetId: runMeta.tireSetId,
      tireRunNumber: runMeta.tireRunNumber,
      createdAt: runMeta.createdAt,
      sessionCompletedAt: runMeta.sessionCompletedAt,
      sortAt: runMeta.sortAt,
    },
    engineerRef
  );

  let hintSummary = engineerSummary;
  let provenance = pick.provenance;
  if (pick.referenceRunId && pick.referenceRunId !== engineerRef) {
    const pair = await getOrComputeEngineerSummaryForRunPair(userId, primaryRunId, pick.referenceRunId);
    if (pair?.summary) {
      hintSummary = pair.summary;
    } else {
      provenance = null;
    }
  }

  const hintFingerprintExtras = provenance
    ? {
        hintReferenceRunId: provenance.hintReferenceRunId,
        hintSelectionReason: provenance.selectionReason,
        hintBaselineAgeBucket: provenance.baselineAgeBucket,
        engineerReferenceRunId: engineerRef,
        hintDiffersFromEngineer: Boolean(engineerRef && engineerRef !== provenance.hintReferenceRunId),
      }
    : null;

  const { recentSessions, fingerprintMaterial, driverContextPack: basePack, chronoPreviousTireMeta } =
    await buildRecentSessionsForBetweenHints({
      userId,
      primaryRunId,
      primaryPairwiseSummary: hintSummary,
      hintFingerprintExtras,
    });

  const chronoCount = fingerprintMaterial.contextExtras?.chronologicalChangeCount ?? 0;
  const signals = computeBetweenRunSignals(hintSummary, runMeta.handlingAssessmentJson, {
    chronologicalTuningChangeCount: chronoCount,
  });

  const sessionBrief = buildHintSessionBrief({
    signals,
    summary: hintSummary,
    handlingProblems: runMeta.handlingProblems,
    baselineProvenance: provenance,
  });

  const driverContextPack: BetweenRunHintPayloadV2["driverContextPack"] = {
    ...basePack,
    pairwiseSetupDigest: buildPairwiseSetupDigestForHints(hintSummary),
    baselineProvenance: provenance,
    suggestedChangesPreview: clampText(runMeta.suggestedChanges, 420),
    suggestedPreRunPreview: clampText(runMeta.suggestedPreRun, 420),
    tireContextLine: buildTireContextLine(
      { tireSetId: runMeta.tireSetId, tireRunNumber: runMeta.tireRunNumber },
      chronoPreviousTireMeta
    ),
    hintSessionBrief: sessionBrief,
  };

  const fp = buildBetweenRunHintFingerprint({
    summary: hintSummary,
    handlingAssessmentJson: runMeta.handlingAssessmentJson ?? null,
    recentSessionsMaterial: fingerprintMaterial,
    engineerSummaryReferenceRunId: engineerRef,
  });

  return {
    scope,
    engineerSummary,
    hintSummary,
    provenance,
    runMeta,
    recentSessions,
    fingerprintMaterial,
    driverContextPack,
    fp,
    signals,
  };
}
