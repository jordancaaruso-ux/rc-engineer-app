import "server-only";

import { prisma } from "@/lib/prisma";
import { getEffectiveRunNotes } from "@/lib/engineerPhase5/mergeRunNotes";
import { buildEngineerRichContextV1 } from "@/lib/engineerPhase5/engineerRichContext";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import { normalizeSetupData } from "@/lib/runSetup";
import { searchVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import { buildDashboardSuggestionFingerprint } from "@/lib/engineerPhase5/dashboardSuggestions/buildDashboardSuggestionFingerprint";
import { generateDashboardEngineerSuggestionPayload } from "@/lib/engineerPhase5/dashboardSuggestions/generateDashboardEngineerSuggestionPayload";
import type { DashboardEngineerSuggestionPayloadV1 } from "@/lib/engineerPhase5/dashboardSuggestions/dashboardSuggestionTypes";

const runSelect = {
  id: true,
  sortAt: true,
  carId: true,
  loggingComplete: true,
  loggingCompletedAt: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  handlingAssessmentJson: true,
  suggestedChanges: true,
  appliedChanges: true,
  setupSnapshotId: true,
  setupSnapshot: { select: { id: true, data: true } },
  car: { select: { id: true, name: true } },
  track: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
} as const;

function parsePayload(raw: unknown): DashboardEngineerSuggestionPayloadV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (typeof o.primaryRunId !== "string" || !o.primaryRunId.trim()) return null;
  if (typeof o.headline !== "string" || !o.headline.trim()) return null;
  if (!Array.isArray(o.bullets)) return null;
  const bullets = o.bullets.filter((b): b is string => typeof b === "string" && b.trim().length > 0);
  if (bullets.length < 1) return null;
  const tryNext = Array.isArray(o.tryNextSession)
    ? o.tryNextSession.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    : [];
  if (typeof o.generatedAtIso !== "string" || !o.generatedAtIso.trim()) return null;
  if (typeof o.sourcesNote !== "string" || !o.sourcesNote.trim()) return null;
  if (typeof o.engineerHref !== "string" || !o.engineerHref.trim()) return null;
  return o as DashboardEngineerSuggestionPayloadV1;
}

function isEligible(run: {
  loggingComplete: boolean;
  loggingCompletedAt: Date | null;
  carId: string | null;
}): boolean {
  if (!run.carId) return false;
  return Boolean(run.loggingCompletedAt) || run.loggingComplete;
}

function scopeLineFromRun(run: {
  car: { name: string } | null;
  track: { name: string } | null;
  event: { name: string } | null;
}): string {
  const parts = [run.car?.name ?? "Car"];
  if (run.track?.name) parts.push(run.track.name);
  if (run.event?.name) parts.push(run.event.name);
  return parts.join(" · ");
}

export async function getOrComputeDashboardSuggestion(
  userId: string,
  primaryRunId: string,
  opts?: { force?: boolean }
): Promise<{ suggestions: DashboardEngineerSuggestionPayloadV1 | null; cached: boolean }> {
  const run = await prisma.run.findFirst({
    where: { id: primaryRunId, userId },
    select: runSelect,
  });
  if (!run || !isEligible(run)) {
    return { suggestions: null, cached: false };
  }

  const prior = run.carId
    ? await prisma.run.findFirst({
        where: {
          userId,
          carId: run.carId,
          id: { not: run.id },
          sortAt: { lt: run.sortAt },
        },
        orderBy: { sortAt: "desc" },
        select: {
          id: true,
          setupSnapshot: { select: { id: true, data: true } },
        },
      })
    : null;

  const lastUserMessage = getEffectiveRunNotes({
    notes: run.notes,
    driverNotes: run.driverNotes,
    handlingProblems: run.handlingProblems,
    handlingAssessmentJson: run.handlingAssessmentJson,
  });
  const notesPreview =
    lastUserMessage.trim() ||
    "(no notes or handling text — lean on setup vs typical and KB only; say what is missing.)";

  const rich = await buildEngineerRichContextV1({
    userId,
    anchorRunId: run.id,
    lastUserMessage: notesPreview.slice(0, 4000),
  });

  const spreadSlim =
    rich?.setupVsSpread.rows.slice(0, 60).map((r) => ({
      key: r.parameterKey,
      positionBand: r.positionBand,
      currentDisplay: r.currentDisplay,
      median: r.spread?.median ?? null,
    })) ?? [];

  const curSetup = normalizeSetupData(run.setupSnapshot?.data ?? null);
  const prevSetup = prior?.setupSnapshot?.data != null ? normalizeSetupData(prior.setupSnapshot.data) : null;
  const diffRows = buildSetupDiffRows(curSetup, prevSetup).filter((r) => r.changed);
  const setupDiffChanged = diffRows.slice(0, 40).map((r) => ({
    key: r.key,
    label: r.label,
    previous: r.previous,
    current: r.current,
  }));

  const summaryResult = await getOrComputeEngineerSummaryForRun(userId, run.id).catch(() => null);
  const summaryJson = summaryResult?.summary
    ? JSON.stringify({
        lapOutcome: summaryResult.summary.lapOutcome,
        setupChanges: summaryResult.summary.setupChanges.slice(0, 24),
        interpretation: summaryResult.summary.interpretation,
        referenceRunId: summaryResult.summary.referenceRunId,
      }).slice(0, 6000)
    : null;

  const fp = buildDashboardSuggestionFingerprint({
    notes: run.notes,
    driverNotes: run.driverNotes,
    handlingProblems: run.handlingProblems,
    handlingAssessmentJson: run.handlingAssessmentJson,
    suggestedChanges: run.suggestedChanges,
    appliedChanges: run.appliedChanges,
    setupSnapshotId: run.setupSnapshotId,
    priorRunId: prior?.id ?? null,
    priorSetupSnapshotId: prior?.setupSnapshot?.id ?? null,
    spreadMaterial: spreadSlim,
    engineerSummaryFieldFingerprint: summaryResult?.summary.fieldFingerprint ?? null,
  });

  const existing = await prisma.engineerDashboardSuggestion.findUnique({
    where: { primaryRunId: run.id },
  });
  if (
    existing &&
    existing.userId === userId &&
    existing.inputFingerprint === fp &&
    !opts?.force
  ) {
    const parsed = parsePayload(existing.payloadJson);
    if (parsed) return { suggestions: parsed, cached: true };
  }

  const kbQuery = `${notesPreview.slice(0, 400)} RC touring car chassis setup handling understeer oversteer`.slice(
    0,
    500
  );
  const kbSnippets = await searchVehicleDynamicsKb(kbQuery, 6);

  const engineerHref =
    prior != null
      ? `/engineer?${new URLSearchParams({ runId: run.id, compareRunId: prior.id }).toString()}`
      : `/engineer?${new URLSearchParams({ runId: run.id }).toString()}`;

  const payload = await generateDashboardEngineerSuggestionPayload({
    primaryRunId: run.id,
    scopeLine: scopeLineFromRun(run),
    kbSnippets,
    setupDiffChanged,
    spreadSlim,
    suggestedChanges: run.suggestedChanges,
    appliedChanges: run.appliedChanges,
    notesPreview,
    summaryJson,
    engineerHref,
  });

  await prisma.engineerDashboardSuggestion.upsert({
    where: { primaryRunId: run.id },
    create: {
      userId,
      primaryRunId: run.id,
      inputFingerprint: fp,
      payloadJson: payload as object,
    },
    update: {
      inputFingerprint: fp,
      payloadJson: payload as object,
    },
  });

  return { suggestions: payload, cached: false };
}

export async function peekDashboardSuggestion(
  userId: string,
  primaryRunId: string
): Promise<DashboardEngineerSuggestionPayloadV1 | null> {
  const row = await prisma.engineerDashboardSuggestion.findUnique({
    where: { primaryRunId },
  });
  if (!row || row.userId !== userId) return null;

  const run = await prisma.run.findFirst({
    where: { id: primaryRunId, userId },
    select: {
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      handlingAssessmentJson: true,
      suggestedChanges: true,
      appliedChanges: true,
      setupSnapshotId: true,
      loggingComplete: true,
      loggingCompletedAt: true,
      carId: true,
      sortAt: true,
    },
  });
  if (!run || !isEligible(run)) return null;

  const prior = run.carId
    ? await prisma.run.findFirst({
        where: {
          userId,
          carId: run.carId,
          id: { not: primaryRunId },
          sortAt: { lt: run.sortAt },
        },
        orderBy: { sortAt: "desc" },
        select: { id: true, setupSnapshot: { select: { id: true } } },
      })
    : null;

  const lastUserMessage = getEffectiveRunNotes({
    notes: run.notes,
    driverNotes: run.driverNotes,
    handlingProblems: run.handlingProblems,
    handlingAssessmentJson: run.handlingAssessmentJson,
  });
  const notesPreview =
    lastUserMessage.trim() ||
    "(no notes or handling text — lean on setup vs typical and KB only; say what is missing.)";

  const rich = await buildEngineerRichContextV1({
    userId,
    anchorRunId: primaryRunId,
    lastUserMessage: notesPreview.slice(0, 4000),
  });

  const spreadSlim =
    rich?.setupVsSpread.rows.slice(0, 60).map((r) => ({
      key: r.parameterKey,
      positionBand: r.positionBand,
      currentDisplay: r.currentDisplay,
      median: r.spread?.median ?? null,
    })) ?? [];

  const summaryResult = await getOrComputeEngineerSummaryForRun(userId, primaryRunId).catch(() => null);

  const fp = buildDashboardSuggestionFingerprint({
    notes: run.notes,
    driverNotes: run.driverNotes,
    handlingProblems: run.handlingProblems,
    handlingAssessmentJson: run.handlingAssessmentJson,
    suggestedChanges: run.suggestedChanges,
    appliedChanges: run.appliedChanges,
    setupSnapshotId: run.setupSnapshotId,
    priorRunId: prior?.id ?? null,
    priorSetupSnapshotId: prior?.setupSnapshot?.id ?? null,
    spreadMaterial: spreadSlim,
    engineerSummaryFieldFingerprint: summaryResult?.summary.fieldFingerprint ?? null,
  });

  if (fp !== row.inputFingerprint) return null;
  return parsePayload(row.payloadJson);
}
