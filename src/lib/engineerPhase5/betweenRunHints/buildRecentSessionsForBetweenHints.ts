import "server-only";

import { prisma } from "@/lib/prisma";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import { pickEngineerReferenceRunId } from "@/lib/engineerPhase5/pickEngineerReferenceRun";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import type {
  BetweenRunRecentSessionSnapshotV1,
  RecentSessionsFingerprintMaterial,
} from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { paceVsFieldSummaryFromEngineerSummary } from "@/lib/engineerPhase5/betweenRunHints/paceVsFieldSummary";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { parseHandlingAssessmentJson, HANDLING_TRAIT_LABELS } from "@/lib/runHandlingAssessment";
import { normalizeSetupData } from "@/lib/runSetup";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";

const runSelectForRefPick = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  trackId: true,
  tireSetId: true,
  tireRunNumber: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  handlingAssessmentJson: true,
  track: { select: { name: true } },
  trackNameSnapshot: true,
  setupSnapshot: { select: { data: true } },
} as const;

function clampText(s: string | null | undefined, max: number): string | null {
  const t = s?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function runDisplayLabel(run: {
  track: { name: string } | null;
  trackNameSnapshot: string | null;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  loggingCompletedAt: Date | null;
}): string {
  const track = run.track?.name?.trim() || run.trackNameSnapshot?.trim() || "Track";
  const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(run));
  return `${track} · ${when}`;
}

function handlingPreviewFromRun(
  handlingProblems: string | null,
  handlingAssessmentJson: unknown
): string | null {
  const bits: string[] = [];
  const hp = handlingProblems?.trim();
  if (hp) bits.push(hp);
  const p = parseHandlingAssessmentJson(handlingAssessmentJson);
  if (p?.mainProblem?.trim()) bits.push(`Focus: ${p.mainProblem.trim()}`);
  if (p?.traitTags?.length) {
    bits.push(
      p.traitTags
        .map((t) => HANDLING_TRAIT_LABELS[t] ?? t)
        .join(", ")
    );
  }
  if (p?.traitsOther?.trim()) bits.push(p.traitsOther.trim());
  if (p?.feelVsLastRun != null && typeof p.feelVsLastRun === "number") {
    const f = p.feelVsLastRun;
    if (f !== 0) bits.push(`Feel vs prior: ${f > 0 ? "+" : ""}${f}`);
  }
  if (!bits.length) return null;
  return clampText(bits.join(" · "), 320);
}

function notesPreviewFromRun(notes: string | null, driverNotes: string | null): string | null {
  const n = notes?.trim() || driverNotes?.trim();
  return clampText(n ?? null, 260);
}

function currentSetupLinesFromSnapshot(data: unknown): string[] {
  const cur = normalizeSetupData(data);
  const rows = buildSetupDiffRows(cur, null);
  const lines: string[] = [];
  for (const r of rows) {
    if (!isTuningComparisonKey(r.key)) continue;
    if (r.current === "—" || !r.current.trim()) continue;
    lines.push(`${r.label}: ${r.current}${r.unit ? ` ${r.unit}` : ""}`.trim());
    if (lines.length >= 22) break;
  }
  return lines;
}

async function loadReferenceChainRunIds(userId: string, primaryRunId: string, max: number): Promise<string[]> {
  const chain: string[] = [];
  let cur: string | null = primaryRunId;
  const guard = new Set<string>();

  while (cur && chain.length < max) {
    if (guard.has(cur)) break;
    guard.add(cur);
    chain.push(cur);

    const run = await prisma.run.findFirst({
      where: { id: cur, userId },
      select: {
        id: true,
        carId: true,
        trackId: true,
        tireSetId: true,
        tireRunNumber: true,
        createdAt: true,
        sessionCompletedAt: true,
      },
    });
    if (!run?.carId) break;
    const ref = await pickEngineerReferenceRunId(userId, {
      id: run.id,
      carId: run.carId,
      trackId: run.trackId,
      tireSetId: run.tireSetId,
      tireRunNumber: run.tireRunNumber,
      createdAt: run.createdAt,
      sessionCompletedAt: run.sessionCompletedAt,
    });
    cur = ref;
  }

  return chain;
}

export async function buildRecentSessionsForBetweenHints(params: {
  userId: string;
  primaryRunId: string;
}): Promise<{
  recentSessions: BetweenRunRecentSessionSnapshotV1[];
  fingerprintMaterial: RecentSessionsFingerprintMaterial;
  driverContextPack: {
    combinedNotesAndHandling: string;
    currentSetupLines: string[];
  };
}> {
  const runIds = await loadReferenceChainRunIds(params.userId, params.primaryRunId, 3);

  const summaries: Array<{ runId: string; summary: EngineerRunSummaryV2 | null }> = [];
  for (const id of runIds) {
    const res = await getOrComputeEngineerSummaryForRun(params.userId, id);
    summaries.push({ runId: id, summary: res?.summary ?? null });
  }

  const metaRows = await prisma.run.findMany({
    where: { id: { in: runIds }, userId: params.userId },
    select: runSelectForRefPick,
  });
  const metaById = new Map(metaRows.map((r) => [r.id, r]));

  const recentSessions: BetweenRunRecentSessionSnapshotV1[] = [];
  const fpPerRun: RecentSessionsFingerprintMaterial["perRun"] = [];

  for (const { runId, summary } of summaries) {
    const meta = metaById.get(runId);
    const label = meta ? runDisplayLabel(meta) : runId;
    const pace = summary ? paceVsFieldSummaryFromEngineerSummary(summary) : null;
    const paceMetrics = summary?.importedSessionFieldStats?.paceVsFieldMeanAnalysis ?? null;
    const paceMetricsSig =
      paceMetrics && paceMetrics.length > 0
        ? paceMetrics
            .map(
              (m) =>
                `${m.metric}:${m.fieldMeanSeconds ?? ""}:${m.userSeconds ?? ""}:${m.gapUserMinusFieldMeanSeconds ?? ""}:${m.rankInField ?? ""}:${m.meaningful ? 1 : 0}`
            )
            .join("|")
        : null;
    const setupLines =
      summary?.setupChanges.map((c) => `${c.label}: ${c.before} → ${c.after}`) ?? [];
    const bestFlag = summary?.lapOutcome.best.flag ?? null;

    recentSessions.push({
      runId,
      displayLabel: label,
      bestLapSeconds: summary?.lapOutcome.best.current ?? null,
      bestLapVsPreviousFlag: summary?.referenceRunId ? bestFlag : null,
      paceVsFieldSummary: pace,
      paceVsFieldMetrics: paceMetrics && paceMetrics.length > 0 ? paceMetrics : null,
      setupChangesFromPrevious: setupLines,
      notesPreview: meta ? notesPreviewFromRun(meta.notes, meta.driverNotes) : null,
      handlingPreview: meta ? handlingPreviewFromRun(meta.handlingProblems, meta.handlingAssessmentJson) : null,
    });

    fpPerRun.push({
      runId,
      fieldFingerprint: summary?.fieldFingerprint ?? "",
      bestFlag,
      setupSig: (summary?.setupChanges ?? []).map((c) => `${c.key}:${c.before}>${c.after}`),
      paceLine: pace,
      paceMetricsSig,
    });
  }

  const primaryMeta = metaById.get(runIds[0] ?? "");
  const primarySummary = summaries[0]?.summary ?? null;
  const noteBits: string[] = [];
  if (primaryMeta) {
    const np = notesPreviewFromRun(primaryMeta.notes, primaryMeta.driverNotes);
    if (np) noteBits.push(`Notes: ${np}`);
    const hp = handlingPreviewFromRun(primaryMeta.handlingProblems, primaryMeta.handlingAssessmentJson);
    if (hp) noteBits.push(`Handling: ${hp}`);
  }
  if (primarySummary?.interpretation?.trim()) {
    noteBits.push(`Summary: ${clampText(primarySummary.interpretation.trim(), 400)}`);
  }

  const setupLines = primaryMeta ? currentSetupLinesFromSnapshot(primaryMeta.setupSnapshot?.data) : [];

  return {
    recentSessions,
    fingerprintMaterial: { runIds, perRun: fpPerRun },
    driverContextPack: {
      combinedNotesAndHandling: noteBits.join("\n"),
      currentSetupLines: setupLines,
    },
  };
}
