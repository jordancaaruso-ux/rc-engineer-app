import "server-only";

import { prisma } from "@/lib/prisma";
import { buildPatternDigestV1 } from "@/lib/engineerPhase5/patternDigest";
import { searchVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import { assembleBetweenRunHintPayload, buildKbQueryForBetweenRunHints } from "@/lib/engineerPhase5/betweenRunHints/generateBetweenRunHints";
import { prepareBetweenRunHintComputation } from "@/lib/engineerPhase5/betweenRunHints/prepareBetweenRunHintComputation";
import type { BetweenRunHintPayloadV2 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";

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

  const prep = await prepareBetweenRunHintComputation(userId, primaryRunId);
  if (!prep) return null;

  if (prep.fp !== row.inputFingerprint) return null;

  return parseHintPayload(row.payloadJson);
}

export async function getOrComputeBetweenRunHint(
  userId: string,
  primaryRunId: string,
  opts?: { force?: boolean }
): Promise<{ hint: BetweenRunHintPayloadV2 | null; cached: boolean }> {
  const prep = await prepareBetweenRunHintComputation(userId, primaryRunId, {
    forceEngineerSummary: Boolean(opts?.force),
  });
  if (!prep) return { hint: null, cached: false };

  const existing = await prisma.engineerBetweenRunHint.findUnique({
    where: { primaryRunId },
  });
  if (
    existing &&
    existing.userId === userId &&
    existing.inputFingerprint === prep.fp &&
    !opts?.force
  ) {
    const parsed = parseHintPayload(existing.payloadJson);
    if (parsed) return { hint: parsed, cached: true };
  }

  const digest =
    (await buildPatternDigestV1({
      userId,
      carId: prep.scope.carId,
      eventId: prep.scope.eventId,
      trackId: prep.scope.trackId,
      limit: 28,
    })) ?? null;

  const extraKbTerms = [
    ...(prep.driverContextPack.chronologicalSetupChangeLines?.slice(0, 4) ?? []),
    ...(prep.driverContextPack.hintSessionBrief?.optionalFieldCommentary?.slice(0, 2) ?? []),
  ];
  const kbQuery = buildKbQueryForBetweenRunHints({
    summary: prep.hintSummary,
    handlingProblems: prep.runMeta.handlingProblems,
    extraTerms: extraKbTerms.length > 0 ? extraKbTerms : null,
  });
  const kbSnippets = await searchVehicleDynamicsKb(kbQuery, 6);

  const payload = await assembleBetweenRunHintPayload({
    scope: prep.scope,
    summary: prep.hintSummary,
    signals: prep.signals,
    patternDigest: digest,
    kbSnippets,
    referenceLabel: prep.hintSummary.referenceLabel,
    recentSessions: prep.recentSessions,
    driverContextPack: prep.driverContextPack,
  });

  await prisma.engineerBetweenRunHint.upsert({
    where: { primaryRunId },
    create: {
      userId,
      primaryRunId,
      referenceRunId: prep.hintSummary.referenceRunId,
      inputFingerprint: prep.fp,
      payloadJson: payload as object,
    },
    update: {
      referenceRunId: prep.hintSummary.referenceRunId,
      inputFingerprint: prep.fp,
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
