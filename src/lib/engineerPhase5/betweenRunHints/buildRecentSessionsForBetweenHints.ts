import "server-only";

import { prisma } from "@/lib/prisma";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import { pickEngineerReferenceRunId } from "@/lib/engineerPhase5/pickEngineerReferenceRun";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import type {
  BetweenRunRecentSessionSnapshotV1,
  BetweenRunHintPayloadV2,
  RecentSessionsFingerprintMaterial,
} from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { paceVsFieldSummaryFromEngineerSummary } from "@/lib/engineerPhase5/betweenRunHints/paceVsFieldSummary";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  formatHandlingTraitAxisForEngineer,
  formatPrimaryFocusLine,
  parseHandlingAssessmentJson,
  type HandlingTraitAxisKey,
  type PhaseBalance,
} from "@/lib/runHandlingAssessment";
import { normalizeSetupData } from "@/lib/runSetup";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";

const TRAIT_PREVIEW_AXES: HandlingTraitAxisKey[] = [
  "feelSteering",
  "feelGeneral",
  "driveEase",
  "tractionRoll",
];

function isPhaseBalanceValue(n: unknown): n is PhaseBalance {
  return typeof n === "number" && Number.isInteger(n) && n >= -3 && n <= 3;
}

const PRIMARY_HANDLING_THIN_CHAR_LIMIT = 72;

function handlingShowsPushBias(handlingProblems: string | null, handlingAssessmentJson: unknown): boolean {
  const hp = handlingProblems?.toLowerCase() ?? "";
  if (/\b(understeer|push)\b/.test(hp)) return true;
  const parsed = parseHandlingAssessmentJson(handlingAssessmentJson);
  const b = parsed?.balanceByPhase;
  if (!b) return false;
  for (const phase of ["entry", "mid", "exit"] as const) {
    const v = b[phase];
    if (isPhaseBalanceValue(v) && v < 0) return true;
  }
  return false;
}

const runSelectForRefPick = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  sortAt: true,
  carId: true,
  trackId: true,
  tireSetId: true,
  tireRunNumber: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  handlingAssessmentJson: true,
  bestLapSeconds: true,
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
  if (p?.primaryFocus) {
    const line = formatPrimaryFocusLine(p.primaryFocus).trim();
    if (line) bits.push(line);
  }
  for (const axis of TRAIT_PREVIEW_AXES) {
    const v = p?.[axis];
    if (isPhaseBalanceValue(v)) bits.push(formatHandlingTraitAxisForEngineer(axis, v));
  }
  if (p?.feelVsLastRun != null && typeof p.feelVsLastRun === "number") {
    const f = p.feelVsLastRun;
    if (f !== 0) bits.push(`Feel vs prior: ${f > 0 ? "+" : ""}${f}`);
  }
  const b = p?.balanceByPhase;
  if (b && (b.entry != null || b.mid != null || b.exit != null)) {
    const parts: string[] = [];
    if (b.entry != null) parts.push(`E ${b.entry > 0 ? "+" : ""}${b.entry}`);
    if (b.mid != null) parts.push(`M ${b.mid > 0 ? "+" : ""}${b.mid}`);
    if (b.exit != null) parts.push(`X ${b.exit > 0 ? "+" : ""}${b.exit}`);
    if (parts.length) bits.push(`Balance ${parts.join(" · ")}`);
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

/** Tuning-only lines for primary vs chronological previous snapshot (Engineer ref may be absent). */
function chronologicalTuningChangeLines(currentData: unknown, previousData: unknown): string[] {
  const rows = buildSetupDiffRows(normalizeSetupData(currentData), normalizeSetupData(previousData));
  const lines: string[] = [];
  for (const r of rows) {
    if (!r.changed) continue;
    if (!isTuningComparisonKey(r.key)) continue;
    const before = r.previous?.trim() ? r.previous : "—";
    const after = r.current?.trim() ? r.current : "—";
    lines.push(`${r.label}: ${before} → ${after}${r.unit ? ` ${r.unit}` : ""}`.trim());
    if (lines.length >= 24) break;
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
  /**
   * When hints compare the primary to a different baseline than `getOrComputeEngineerSummaryForRun`,
   * pass that pairwise summary so the primary recent-session card matches what the LLM sees in `summaryJson`.
   */
  primaryPairwiseSummary?: EngineerRunSummaryV2 | null;
  /** When set, merged into fingerprint `contextExtras` so hint cache invalidates on hint-baseline policy inputs. */
  hintFingerprintExtras?: {
    hintReferenceRunId: string;
    hintSelectionReason: string;
    hintBaselineAgeBucket: string;
    engineerReferenceRunId: string | null;
    hintDiffersFromEngineer: boolean;
  } | null;
}): Promise<{
  recentSessions: BetweenRunRecentSessionSnapshotV1[];
  fingerprintMaterial: RecentSessionsFingerprintMaterial;
  driverContextPack: BetweenRunHintPayloadV2["driverContextPack"];
  chronoPreviousTireMeta: { tireSetId: string | null; tireRunNumber: number } | null;
}> {
  const runIds = await loadReferenceChainRunIds(params.userId, params.primaryRunId, 3);

  const summaries: Array<{ runId: string; summary: EngineerRunSummaryV2 | null }> = [];
  for (const id of runIds) {
    if (id === params.primaryRunId && params.primaryPairwiseSummary) {
      summaries.push({ runId: id, summary: params.primaryPairwiseSummary });
    } else {
      const res = await getOrComputeEngineerSummaryForRun(params.userId, id);
      summaries.push({ runId: id, summary: res?.summary ?? null });
    }
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
    const hasRef = Boolean(summary?.referenceRunId);
    const lo = summary?.lapOutcome;

    recentSessions.push({
      runId,
      displayLabel: label,
      bestLapSeconds: summary?.lapOutcome.best.current ?? null,
      bestLapVsPreviousFlag: hasRef ? bestFlag : null,
      avgTop5LapSeconds: lo?.avgTop5.notMeaningful ? null : (lo?.avgTop5.current ?? null),
      avgTop10LapSeconds: lo?.avgTop10.notMeaningful ? null : (lo?.avgTop10.current ?? null),
      avgTop5NotMeaningful: lo?.avgTop5.notMeaningful,
      avgTop10NotMeaningful: lo?.avgTop10.notMeaningful,
      avgTop5VsPreviousFlag: hasRef ? (lo?.avgTop5.flag ?? null) : null,
      avgTop10VsPreviousFlag: hasRef ? (lo?.avgTop10.flag ?? null) : null,
      paceVsFieldSummary: pace,
      paceVsFieldMetrics: paceMetrics && paceMetrics.length > 0 ? paceMetrics : null,
      setupChangesFromPrevious: setupLines,
      notesPreview: meta ? notesPreviewFromRun(meta.notes, meta.driverNotes) : null,
      handlingPreview: meta ? handlingPreviewFromRun(meta.handlingProblems, meta.handlingAssessmentJson) : null,
    });

    const lapMultiSig = lo
      ? `${lo.avgTop5.current ?? ""}:${lo.avgTop10.current ?? ""}:${lo.avgTop5.flag}:${lo.avgTop10.flag}:${lo.avgTop5.notMeaningful ? 1 : 0}:${lo.avgTop10.notMeaningful ? 1 : 0}`
      : null;

    fpPerRun.push({
      runId,
      fieldFingerprint: summary?.fieldFingerprint ?? "",
      bestFlag,
      setupSig: (summary?.setupChanges ?? []).map((c) => `${c.key}:${c.before}>${c.after}`),
      paceLine: pace,
      paceMetricsSig,
      lapMultiSig,
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

  let previousRunHandling: string | null = null;
  let chronologicalSetupChangeLines: string[] = [];
  let chronoPreviousTireMeta: { tireSetId: string | null; tireRunNumber: number } | null = null;
  let bestPaceBaseline: {
    runId: string;
    displayLabel: string;
    setupLines: string[];
  } | null = null;

  const primaryCarId = primaryMeta?.carId ?? null;
  if (primaryCarId && primaryMeta) {
    const carRuns = await prisma.run.findMany({
      where: { userId: params.userId, carId: primaryCarId },
      orderBy: [{ sortAt: "desc" }, { createdAt: "desc" }],
      take: 60,
      select: runSelectForRefPick,
    });
    const idx = carRuns.findIndex((r) => r.id === params.primaryRunId);
    const chronologicalPrevious = idx >= 0 && idx < carRuns.length - 1 ? carRuns[idx + 1]! : null;
    if (chronologicalPrevious) {
      chronoPreviousTireMeta = {
        tireSetId: chronologicalPrevious.tireSetId,
        tireRunNumber: chronologicalPrevious.tireRunNumber,
      };
      previousRunHandling = handlingPreviewFromRun(
        chronologicalPrevious.handlingProblems,
        chronologicalPrevious.handlingAssessmentJson
      );
      chronologicalSetupChangeLines = chronologicalTuningChangeLines(
        primaryMeta.setupSnapshot?.data,
        chronologicalPrevious.setupSnapshot?.data
      );
    }

    const paceCandidates = carRuns.filter(
      (r) => r.id !== params.primaryRunId && r.bestLapSeconds != null && Number.isFinite(r.bestLapSeconds)
    );
    let bestRun: (typeof carRuns)[number] | null = null;
    let bestSec = Infinity;
    for (const r of paceCandidates) {
      const t = r.bestLapSeconds as number;
      if (t < bestSec) {
        bestSec = t;
        bestRun = r;
      } else if (t === bestSec && bestRun && r.sortAt != null && bestRun.sortAt != null) {
        if (r.sortAt > bestRun.sortAt) bestRun = r;
      }
    }
    if (bestRun) {
      bestPaceBaseline = {
        runId: bestRun.id,
        displayLabel: runDisplayLabel(bestRun),
        setupLines: currentSetupLinesFromSnapshot(bestRun.setupSnapshot?.data),
      };
    }
  }

  const bestPaceLinesSig = bestPaceBaseline?.setupLines.join("|") ?? "";

  let priorHandlingCarryforward: string | null = null;
  const primaryHandlingPreview = primaryMeta
    ? handlingPreviewFromRun(primaryMeta.handlingProblems, primaryMeta.handlingAssessmentJson)
    : null;
  const primaryHandlingThin =
    !primaryHandlingPreview ||
    primaryHandlingPreview.replace(/\s+/g, " ").trim().length < PRIMARY_HANDLING_THIN_CHAR_LIMIT;
  if (primaryMeta && primaryHandlingThin) {
    const olderBits: string[] = [];
    for (const id of runIds.slice(1)) {
      const m = metaById.get(id);
      if (!m) continue;
      if (!handlingShowsPushBias(m.handlingProblems, m.handlingAssessmentJson)) continue;
      const preview = handlingPreviewFromRun(m.handlingProblems, m.handlingAssessmentJson);
      olderBits.push(`${runDisplayLabel(m)}${preview ? ` — ${preview}` : ""}`);
      if (olderBits.length >= 2) break;
    }
    if (olderBits.length > 0) {
      priorHandlingCarryforward =
        `Earlier on this car (see recentSessions[1+].handlingPreview): ${olderBits.join(" · ")}. ` +
        `Latest handlingPreview is thin — if push/understeer is not clearly resolved on the newest session, verify balance before stacking more tuning moves.`;
      if (priorHandlingCarryforward.length > 480) {
        priorHandlingCarryforward = `${priorHandlingCarryforward.slice(0, 479)}…`;
      }
    }
  }

  const hintX = params.hintFingerprintExtras;
  const fingerprintMaterial: RecentSessionsFingerprintMaterial = {
    runIds,
    perRun: fpPerRun,
    contextExtras: {
      previousRunHandling,
      bestPaceRunId: bestPaceBaseline?.runId ?? null,
      bestPaceLinesSig,
      chronologicalChangeCount: chronologicalSetupChangeLines.length,
      priorHandlingSig: priorHandlingCarryforward ?? "",
      ...(hintX
        ? {
            hintReferenceRunId: hintX.hintReferenceRunId,
            hintSelectionReason: hintX.hintSelectionReason,
            hintBaselineAgeBucket: hintX.hintBaselineAgeBucket,
            engineerReferenceRunId: hintX.engineerReferenceRunId,
            hintDiffersFromEngineer: hintX.hintDiffersFromEngineer,
          }
        : {}),
    },
  };

  const driverContextPack: BetweenRunHintPayloadV2["driverContextPack"] = {
    combinedNotesAndHandling: noteBits.join("\n"),
    currentSetupLines: setupLines,
  };
  if (previousRunHandling) driverContextPack.previousRunHandling = previousRunHandling;
  if (bestPaceBaseline) driverContextPack.bestPaceBaseline = bestPaceBaseline;
  if (chronologicalSetupChangeLines.length > 0) {
    driverContextPack.chronologicalSetupChangeLines = chronologicalSetupChangeLines;
  }
  if (priorHandlingCarryforward) driverContextPack.priorHandlingCarryforward = priorHandlingCarryforward;

  return {
    recentSessions,
    fingerprintMaterial,
    driverContextPack,
    chronoPreviousTireMeta,
  };
}
