import "server-only";

import { getEffectiveRunNotes } from "@/lib/engineerPhase5/mergeRunNotes";
import { buildEngineerRichContextV1 } from "@/lib/engineerPhase5/engineerRichContext";
import { buildEngineeringBrainV1 } from "@/lib/engineerPhase5/engineeringBrain";
import { rankSetupChangesForEngineer } from "@/lib/engineerPhase5/rankSetupChangesForEngineer";
import { loadNumericAggregationMapForCar } from "@/lib/engineerPhase5/loadNumericAggregationMapForCar";
import { pickEngineerReferenceRunId } from "@/lib/engineerPhase5/pickEngineerReferenceRun";
import { prisma } from "@/lib/prisma";
import { parseHandlingAssessmentJson } from "@/lib/runHandlingAssessment";
import {
  communityBoldnessHint,
  inferPrimaryHandlingIssue,
  magnitudeTierFromCarRating,
  magnitudeTierPromptLine,
} from "@/lib/engineerPhase5/quickFix/quickFixMagnitude";
import type { QuickFixRunRow } from "@/lib/engineerPhase5/quickFix/quickFixRunAccess";
import { kbPhysicsPromptLinesForKeys } from "@/lib/engineerPhase5/kbSetupKeyPhysics";

export type QuickFixLlmContext = {
  scopeLine: string;
  carRating: number | null;
  magnitudeTierLine: string;
  inferredIssue: string | null;
  communityBoldness: string;
  handlingText: string;
  notesPreview: string;
  suggestedChanges: string | null;
  appliedChanges: string | null;
  setupDiffChanged: Array<{ key: string; label: string; previous: string | null; current: string }>;
  allowedChassisKeys: string[];
  spreadSlim: Array<Record<string, unknown>>;
  engineeringBrainPromptLines: string[];
  kbSnippets: Array<{ title: string; excerpt: string }>;
  kbPhysicsPromptLines: string[];
  recommendationMode: string | null;
  recommendationStrength: string | null;
  thinContext: boolean;
};

export async function buildQuickFixLlmContext(params: {
  contextUserId: string;
  run: QuickFixRunRow;
  scopeLine: string;
}): Promise<QuickFixLlmContext> {
  const { contextUserId, run, scopeLine } = params;

  const notesPreview =
    getEffectiveRunNotes({
      notes: run.notes,
      driverNotes: run.driverNotes,
      handlingProblems: run.handlingProblems,
      handlingAssessmentJson: run.handlingAssessmentJson,
    }).trim() ||
    "(no notes or handling text — lean on phase balance, car rating, setup vs typical, and KB only.)";

  const rich = await buildEngineerRichContextV1({
    userId: contextUserId,
    anchorRunId: run.id,
    lastUserMessage: notesPreview.slice(0, 4000),
    opts: { spreadDepth: "full", kbLimit: 8, skipFieldStats: true },
  });

  const spreadSlim =
    rich?.setupVsSpread.rows.slice(0, 40).map((r) => ({
      key: r.parameterKey,
      positionBand: r.positionBand,
      currentDisplay: r.currentDisplay,
      median: r.spread?.median ?? null,
      communityGripLevel: r.communityGripLevel ?? null,
    })) ?? [];

  let priorData: unknown | null = null;
  if (run.carId) {
    const refId = await pickEngineerReferenceRunId(contextUserId, {
      id: run.id,
      carId: run.carId,
      trackId: run.trackId,
      tireSetId: run.tireSetId,
      tireRunNumber: run.tireRunNumber,
      createdAt: run.createdAt,
      sessionCompletedAt: run.sessionCompletedAt,
    });
    if (refId) {
      const prior = await prisma.run.findFirst({
        where: { id: refId, userId: contextUserId },
        select: { setupSnapshot: { select: { data: true } } },
      });
      priorData = prior?.setupSnapshot?.data ?? null;
    }
  }

  const agg = run.carId ? await loadNumericAggregationMapForCar(run.carId) : new Map();
  const setupDiffChanged =
    priorData != null
      ? rankSetupChangesForEngineer(run.setupSnapshot?.data ?? null, priorData, agg, { limit: 30 }).map(
          (r) => ({
            key: r.key,
            label: r.label,
            previous: r.before,
            current: r.after,
          })
        )
      : [];
  const allowedChassisKeys = setupDiffChanged.map((r) => r.key);

  const engineeringBrain = run.carId
    ? await buildEngineeringBrainV1({
        userId: contextUserId,
        carId: run.carId,
        anchorRunId: run.id,
      })
    : null;

  const parsedHandling = parseHandlingAssessmentJson(run.handlingAssessmentJson);
  const inferredIssue = inferPrimaryHandlingIssue(parsedHandling);
  const tier = magnitudeTierFromCarRating(run.carRating);

  const kbSnippets =
    rich?.vehicleDynamicsKb.map((s) => ({ title: s.title, excerpt: s.excerpt.slice(0, 900) })) ?? [];

  const thinContext =
    !run.carRating &&
    !inferredIssue &&
    notesPreview.startsWith("(no notes") &&
    setupDiffChanged.length === 0 &&
    spreadSlim.length === 0;

  return {
    scopeLine,
    carRating: run.carRating,
    magnitudeTierLine: magnitudeTierPromptLine(tier, run.carRating),
    inferredIssue,
    communityBoldness: communityBoldnessHint(spreadSlim),
    handlingText: notesPreview.slice(0, 3500),
    notesPreview,
    suggestedChanges: run.suggestedChanges,
    appliedChanges: run.appliedChanges,
    setupDiffChanged,
    allowedChassisKeys,
    spreadSlim,
    engineeringBrainPromptLines: engineeringBrain?.promptLines ?? [],
    kbSnippets,
    kbPhysicsPromptLines: kbPhysicsPromptLinesForKeys(allowedChassisKeys),
    recommendationMode: engineeringBrain?.engineeringRead.recommendationStrategy.mode ?? null,
    recommendationStrength: engineeringBrain?.engineeringRead.recommendationStrategy.strength ?? null,
    thinContext,
  };
}
