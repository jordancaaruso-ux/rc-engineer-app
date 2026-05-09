import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveImportedTimingFieldStatsForEngineer } from "@/lib/lapImport/importedTimingFieldStatsForEngineer";
import type { PaceVsFieldRunDigestV1, PaceVsFieldRunDigestRowV1 } from "@/lib/engineerPhase5/paceVsFieldRunDigestTypes";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatRunSessionDisplay } from "@/lib/runSession";

const DEFAULT_MAX_SCAN = 90;
const ABS_MAX_SCAN = 160;
const MAX_ROWS = 48;

const runSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  importedLapTimeSessionId: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carId: true,
  carNameSnapshot: true,
  car: { select: { name: true } },
  track: { select: { name: true } },
  trackNameSnapshot: true,
  event: { select: { name: true } },
  importedLapSets: { select: { driverName: true, isPrimaryUser: true } },
} as const;

async function resolveRowForRun(
  userId: string,
  run: {
    id: string;
    importedLapTimeSessionId: string | null;
    importedLapSets: Array<{ driverName: string; isPrimaryUser: boolean }>;
    createdAt: Date;
    sessionCompletedAt: Date | null;
    sessionType: string;
    meetingSessionType: string | null;
    meetingSessionCode: string | null;
    sessionLabel: string | null;
    carId: string | null;
    carNameSnapshot: string | null;
    car: { name: string } | null;
    track: { name: string } | null;
    trackNameSnapshot: string | null;
    event: { name: string } | null;
  }
): Promise<PaceVsFieldRunDigestRowV1 | null> {
  const sid = run.importedLapTimeSessionId?.trim();
  if (!sid) return null;

  const compact = (
    await resolveImportedTimingFieldStatsForEngineer({
      userId,
      importedLapTimeSessionId: sid,
      importedLapSetsForMatch: run.importedLapSets.map((s) => ({
        driverName: s.driverName,
        isPrimaryUser: s.isPrimaryUser,
      })),
    })
  ).compact;

  if (!compact) return null;
  const analysis = compact.paceVsFieldMeanAnalysis;
  if (!analysis?.length) return null;
  const a10 = analysis.find((m) => m.metric === "avg_top_10");
  if (!a10?.meaningful) return null;
  const gap = a10.gapUserMinusFieldMeanSeconds;
  const u = a10.userSeconds;
  const fMean = a10.fieldMeanSeconds;
  if (gap == null || !Number.isFinite(gap) || u == null || fMean == null || !Number.isFinite(u) || !Number.isFinite(fMean)) {
    return null;
  }

  const trackName = run.track?.name?.trim() || run.trackNameSnapshot?.trim() || "—";
  const carName = run.car?.name?.trim() || run.carNameSnapshot?.trim() || "—";
  const eventName = run.event?.name?.trim() || null;
  const when = resolveRunDisplayInstant(run);

  return {
    runId: run.id,
    sortIso: when.toISOString(),
    carId: run.carId,
    carName,
    trackName,
    eventName,
    sessionSummary: formatRunSessionDisplay({
      sessionType: run.sessionType,
      meetingSessionType: run.meetingSessionType,
      meetingSessionCode: run.meetingSessionCode,
      sessionLabel: run.sessionLabel,
    }),
    avgTop10UserSeconds: u,
    avgTop10FieldMeanSeconds: fMean,
    gapUserMinusFieldMeanSeconds: gap,
    rankInField: a10.rankInField,
    fieldEntrantCountForMetric: a10.fieldEntrantCountForMetric,
    sessionDriverCount: compact.driverCount,
  };
}

/**
 * Build a compact list of runs where avg top 10 vs imported session field mean is meaningful.
 * Uses linked ImportedLapTimeSession aggregates only (no full engineer summary).
 */
export async function buildPaceVsFieldRunDigestForUser(params: {
  userId: string;
  /** When set with scope "car", restricts to this car id. */
  scopeCarId?: string | null;
  /** Echo anchor run id in digest metadata (e.g. URL primary). */
  anchorRunId?: string | null;
  maxScan?: number;
}): Promise<PaceVsFieldRunDigestV1> {
  const maxScan = Math.min(ABS_MAX_SCAN, Math.max(15, params.maxScan ?? DEFAULT_MAX_SCAN));
  const scopeCarId = params.scopeCarId?.trim() || null;
  const anchorRunId = params.anchorRunId?.trim() || null;

  const where: Prisma.RunWhereInput = {
    userId: params.userId,
    importedLapTimeSessionId: { not: null },
  };
  if (scopeCarId) where.carId = scopeCarId;

  const [totalWithImport, runs] = await Promise.all([
    prisma.run.count({ where }),
    prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: maxScan,
      select: runSelect,
    }),
  ]);

  const truncatedScan = totalWithImport > maxScan;

  const collected: PaceVsFieldRunDigestRowV1[] = [];
  const chunk = 10;
  for (let i = 0; i < runs.length; i += chunk) {
    const slice = runs.slice(i, i + chunk);
    const part = await Promise.all(slice.map((r) => resolveRowForRun(params.userId, r)));
    for (const row of part) {
      if (row) collected.push(row);
    }
  }

  collected.sort((a, b) => a.gapUserMinusFieldMeanSeconds - b.gapUserMinusFieldMeanSeconds);

  const omittedAfterCap = Math.max(0, collected.length - MAX_ROWS);
  const rows = collected.slice(0, MAX_ROWS);

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    metric: "avg_top_10_vs_field_mean",
    gapMeaning: "user_seconds_minus_field_mean_positive_slower",
    scope: scopeCarId ? "car" : "account",
    scopeCarId: scopeCarId ?? null,
    anchorRunId: anchorRunId ?? null,
    scannedRunCount: runs.length,
    includedRunCount: rows.length,
    omittedAfterCap,
    truncatedScan,
    rows,
  };
}

/** Accept client-reattached digest in chat POST (same shape as GET). */
export function parsePaceVsFieldRunDigestPayload(raw: unknown): PaceVsFieldRunDigestV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (!Array.isArray(o.rows)) return null;
  for (const row of o.rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.runId !== "string" || !r.runId.trim()) return null;
    if (typeof r.gapUserMinusFieldMeanSeconds !== "number" || !Number.isFinite(r.gapUserMinusFieldMeanSeconds)) {
      return null;
    }
  }
  return raw as PaceVsFieldRunDigestV1;
}
