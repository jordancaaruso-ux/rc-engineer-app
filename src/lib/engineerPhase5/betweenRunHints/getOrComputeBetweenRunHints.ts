import "server-only";

import { prisma } from "@/lib/prisma";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import { buildPatternDigestV1 } from "@/lib/engineerPhase5/patternDigest";
import { searchVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import { computeBetweenRunSignals } from "@/lib/engineerPhase5/betweenRunHints/computeBetweenRunSignals";
import { buildBetweenRunHintFingerprint } from "@/lib/engineerPhase5/betweenRunHints/buildBetweenRunHintFingerprint";
import { assembleBetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/generateBetweenRunHints";
import { buildKbQueryForBetweenRunHints } from "@/lib/engineerPhase5/betweenRunHints/generateBetweenRunHints";
import { buildRecentSessionsForBetweenHints } from "@/lib/engineerPhase5/betweenRunHints/buildRecentSessionsForBetweenHints";
import type { BetweenRunHintPayloadV2, BetweenRunHintScopeV1 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";

function parseHintPayload(raw: unknown): BetweenRunHintPayloadV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 2) return null;
  if (typeof o.headline !== "string" || !Array.isArray(o.bullets)) return null;
  if (!Array.isArray(o.recentSessions)) return null;
  const pack = o.driverContextPack;
  if (!pack || typeof pack !== "object") return null;
  const p = pack as Record<string, unknown>;
  if (typeof p.combinedNotesAndHandling !== "string" || !Array.isArray(p.currentSetupLines)) return null;
  return o as BetweenRunHintPayloadV2;
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

/**
 * Fast path for SSR: returns cached payload only when fingerprint still matches.
 */
export async function peekBetweenRunHint(
  userId: string,
  primaryRunId: string
): Promise<BetweenRunHintPayloadV2 | null> {
  const row = await prisma.engineerBetweenRunHint.findUnique({
    where: { primaryRunId },
  });
  if (!row || row.userId !== userId) return null;

  const summaryResult = await getOrComputeEngineerSummaryForRun(userId, primaryRunId);
  if (!summaryResult?.summary.referenceRunId) return null;

  const run = await prisma.run.findFirst({
    where: { id: primaryRunId, userId },
    select: { handlingAssessmentJson: true },
  });

  const { fingerprintMaterial } = await buildRecentSessionsForBetweenHints({
    userId,
    primaryRunId,
  });

  const fp = buildBetweenRunHintFingerprint({
    summary: summaryResult.summary,
    handlingAssessmentJson: run?.handlingAssessmentJson ?? null,
    recentSessionsMaterial: fingerprintMaterial,
  });
  if (fp !== row.inputFingerprint) return null;

  return parseHintPayload(row.payloadJson);
}

export async function getOrComputeBetweenRunHint(
  userId: string,
  primaryRunId: string,
  opts?: { force?: boolean }
): Promise<{ hint: BetweenRunHintPayloadV2 | null; cached: boolean }> {
  const scope = await loadScopeForPrimaryRun(userId, primaryRunId);
  if (!scope) return { hint: null, cached: false };

  const summaryResult = await getOrComputeEngineerSummaryForRun(userId, primaryRunId, {
    force: Boolean(opts?.force),
  });
  if (!summaryResult?.summary.referenceRunId) return { hint: null, cached: false };

  const runMeta = await prisma.run.findFirst({
    where: { id: primaryRunId, userId },
    select: {
      handlingAssessmentJson: true,
      handlingProblems: true,
    },
  });

  const { recentSessions, fingerprintMaterial, driverContextPack } =
    await buildRecentSessionsForBetweenHints({
      userId,
      primaryRunId,
    });

  const fp = buildBetweenRunHintFingerprint({
    summary: summaryResult.summary,
    handlingAssessmentJson: runMeta?.handlingAssessmentJson ?? null,
    recentSessionsMaterial: fingerprintMaterial,
  });

  const existing = await prisma.engineerBetweenRunHint.findUnique({
    where: { primaryRunId },
  });
  if (
    existing &&
    existing.userId === userId &&
    existing.inputFingerprint === fp &&
    !opts?.force
  ) {
    const parsed = parseHintPayload(existing.payloadJson);
    if (parsed) return { hint: parsed, cached: true };
  }

  const signals = computeBetweenRunSignals(
    summaryResult.summary,
    runMeta?.handlingAssessmentJson ?? null
  );

  const digest =
    (await buildPatternDigestV1({
      userId,
      carId: scope.carId,
      eventId: scope.eventId,
      trackId: scope.trackId,
      limit: 28,
    })) ?? null;

  const kbQuery = buildKbQueryForBetweenRunHints({
    summary: summaryResult.summary,
    handlingProblems: runMeta?.handlingProblems ?? null,
  });
  const kbSnippets = await searchVehicleDynamicsKb(kbQuery, 6);

  const payload = await assembleBetweenRunHintPayload({
    scope,
    summary: summaryResult.summary,
    signals,
    patternDigest: digest,
    kbSnippets,
    referenceLabel: summaryResult.summary.referenceLabel,
    recentSessions,
    driverContextPack,
  });

  await prisma.engineerBetweenRunHint.upsert({
    where: { primaryRunId },
    create: {
      userId,
      primaryRunId,
      referenceRunId: summaryResult.summary.referenceRunId,
      inputFingerprint: fp,
      payloadJson: payload as object,
    },
    update: {
      referenceRunId: summaryResult.summary.referenceRunId,
      inputFingerprint: fp,
      payloadJson: payload as object,
    },
  });

  return { hint: payload, cached: false };
}

export async function findLatestPrimaryRunIdForHints(userId: string): Promise<string | null> {
  const run = await prisma.run.findFirst({
    where: {
      userId,
      loggingComplete: true,
      carId: { not: null },
    },
    orderBy: { sortAt: "desc" },
    select: { id: true },
  });
  return run?.id ?? null;
}
