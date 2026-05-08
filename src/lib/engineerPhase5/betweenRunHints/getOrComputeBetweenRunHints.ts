import "server-only";

import { prisma } from "@/lib/prisma";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import { buildPatternDigestV1 } from "@/lib/engineerPhase5/patternDigest";
import { searchVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import { computeBetweenRunSignals } from "@/lib/engineerPhase5/betweenRunHints/computeBetweenRunSignals";
import { buildBetweenRunHintFingerprint } from "@/lib/engineerPhase5/betweenRunHints/buildBetweenRunHintFingerprint";
import { assembleBetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/generateBetweenRunHints";
import { buildKbQueryForBetweenRunHints } from "@/lib/engineerPhase5/betweenRunHints/generateBetweenRunHints";
import type { BetweenRunHintPayloadV1, BetweenRunHintScopeV1 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";

function parseHintPayload(raw: unknown): BetweenRunHintPayloadV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as BetweenRunHintPayloadV1;
  if (o.version !== 1) return null;
  if (typeof o.headline !== "string" || !Array.isArray(o.bullets)) return null;
  return o;
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
): Promise<BetweenRunHintPayloadV1 | null> {
  // #region agent log
  fetch("http://127.0.0.1:7907/ingest/111541b0-cc95-4db2-9bba-e017c776757b", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "f60b14",
    },
    body: JSON.stringify({
      sessionId: "f60b14",
      hypothesisId: "H1",
      location: "getOrComputeBetweenRunHints.ts:peekBetweenRunHint:entry",
      message: "peekBetweenRunHint start",
      data: { primaryRunId, userIdLen: userId?.length ?? 0 },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  let row: Awaited<ReturnType<typeof prisma.engineerBetweenRunHint.findUnique>>;
  try {
    row = await prisma.engineerBetweenRunHint.findUnique({
      where: { primaryRunId },
    });
  } catch (prismaErr: unknown) {
    // #region agent log
    const msg = prismaErr instanceof Error ? prismaErr.message : String(prismaErr);
    const code =
      prismaErr && typeof prismaErr === "object" && "code" in prismaErr
        ? String((prismaErr as { code?: string }).code)
        : "";
    fetch("http://127.0.0.1:7907/ingest/111541b0-cc95-4db2-9bba-e017c776757b", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "f60b14",
      },
      body: JSON.stringify({
        sessionId: "f60b14",
        hypothesisId: "H1",
        location: "getOrComputeBetweenRunHints.ts:peekBetweenRunHint:findUnique.catch",
        message: "engineerBetweenRunHint.findUnique failed",
        data: { errMsg: msg.slice(0, 500), prismaCode: code },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw prismaErr;
  }
  // #region agent log
  fetch("http://127.0.0.1:7907/ingest/111541b0-cc95-4db2-9bba-e017c776757b", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "f60b14",
    },
    body: JSON.stringify({
      sessionId: "f60b14",
      hypothesisId: "H2",
      location: "getOrComputeBetweenRunHints.ts:peekBetweenRunHint:afterFind",
      message: "findUnique ok",
      data: { hasRow: Boolean(row), rowUserMatch: row ? row.userId === userId : false },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!row || row.userId !== userId) return null;

  let summaryResult: Awaited<ReturnType<typeof getOrComputeEngineerSummaryForRun>>;
  try {
    summaryResult = await getOrComputeEngineerSummaryForRun(userId, primaryRunId);
  } catch (summaryErr: unknown) {
    // #region agent log
    fetch("http://127.0.0.1:7907/ingest/111541b0-cc95-4db2-9bba-e017c776757b", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "f60b14",
      },
      body: JSON.stringify({
        sessionId: "f60b14",
        hypothesisId: "H3",
        location: "getOrComputeBetweenRunHints.ts:peekBetweenRunHint:getSummary.catch",
        message: "getOrComputeEngineerSummaryForRun failed in peek",
        data: {
          errMsg:
            summaryErr instanceof Error ? summaryErr.message.slice(0, 500) : String(summaryErr),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw summaryErr;
  }
  if (!summaryResult?.summary.referenceRunId) return null;

  const run = await prisma.run.findFirst({
    where: { id: primaryRunId, userId },
    select: { handlingAssessmentJson: true },
  });
  const fp = buildBetweenRunHintFingerprint({
    summary: summaryResult.summary,
    handlingAssessmentJson: run?.handlingAssessmentJson ?? null,
  });
  if (fp !== row.inputFingerprint) return null;

  return parseHintPayload(row.payloadJson);
}

export async function getOrComputeBetweenRunHint(
  userId: string,
  primaryRunId: string,
  opts?: { force?: boolean }
): Promise<{ hint: BetweenRunHintPayloadV1 | null; cached: boolean }> {
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

  const fp = buildBetweenRunHintFingerprint({
    summary: summaryResult.summary,
    handlingAssessmentJson: runMeta?.handlingAssessmentJson ?? null,
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
