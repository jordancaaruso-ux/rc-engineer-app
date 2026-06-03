import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LapUrlParseResult } from "@/lib/lapUrlParsers/types";
import { parseTimingUrl } from "@/lib/lapUrlParsers/registry";
import { computeImportedSessionFieldStatsFromParse } from "@/lib/lapImport/computeImportedSessionFieldStats";
import {
  validateTimingHttpUrlAsync,
  validateTimingHttpUrlSync,
  type ValidateTimingUrlOptions,
} from "@/lib/http/timingUrlSafety";

export function validateTimingHttpUrl(
  url: string,
  options?: ValidateTimingUrlOptions
): { ok: true; normalized: string } | { ok: false; error: string } {
  return validateTimingHttpUrlSync(url, options);
}

export async function validateTimingHttpUrlResolved(
  url: string,
  options?: ValidateTimingUrlOptions
): Promise<{ ok: true; normalized: string } | { ok: false; error: string }> {
  return validateTimingHttpUrlAsync(url, options);
}

export function inferSourceType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("liverc") || u.includes("live-rc")) return "liverc";
  if (u.includes("speedhive") || u.includes("api2.mylaps.com")) return "speedhive";
  return "timing_url";
}

/** Serializable snapshot of parse result for ImportedLapTimeSession.parsedPayload */
export function serializeParsePayload(parsed: LapUrlParseResult): Record<string, unknown> {
  return {
    parserId: parsed.parserId,
    laps: parsed.laps,
    lapRows: parsed.lapRows ?? null,
    candidates: parsed.candidates ?? [],
    sessionDrivers: parsed.sessionDrivers ?? [],
    sessionHint: parsed.sessionHint ?? null,
    sessionCompletedAtIso: parsed.sessionCompletedAtIso ?? null,
    discoveredRaceUrls: parsed.discoveredRaceUrls ?? null,
    message: parsed.message ?? null,
    errorCode: parsed.errorCode ?? null,
  };
}

export function isImportableParse(parsed: LapUrlParseResult): boolean {
  if (parsed.laps.length > 0) return true;
  const sd = parsed.sessionDrivers ?? [];
  return sd.some((d) => Array.isArray(d.laps) && d.laps.length > 0);
}

export type ImportOneUrlSuccess = {
  url: string;
  success: true;
  importedSessionId: string;
  /** When this import row was stored (fallback only when session completion time is unknown). */
  recordedAt: string;
  /** UTC ISO from timing page when parsed; null if unavailable. */
  sessionCompletedAtIso: string | null;
  /** DB `ImportedLapTimeSession.sessionCompletedAt` after persist (same instant as above when parser supplied a time). */
  sessionCompletedAtDbIso: string | null;
  parserId: string;
  laps: number[];
  lapRows: LapUrlParseResult["lapRows"];
  candidates: LapUrlParseResult["candidates"];
  sessionDrivers: LapUrlParseResult["sessionDrivers"];
  sessionHint: LapUrlParseResult["sessionHint"];
  message: string | null;
  errorCode: string | undefined;
};

export type ImportOneUrlFailure = {
  url: string;
  success: false;
  error: string;
  parserId?: string;
  message?: string | null;
  errorCode?: string;
};

export type ImportOneUrlResult = ImportOneUrlSuccess | ImportOneUrlFailure;

/**
 * Parse URL via shared registry, persist snapshot for the user. Single source of truth for stored imports.
 */
export async function importOneTimingUrl(
  userId: string,
  url: string,
  context?: { driverName?: string; allowAnyPublicHost?: boolean }
): Promise<ImportOneUrlResult> {
  const v = await validateTimingHttpUrlResolved(url, {
    allowAnyPublicHost: context?.allowAnyPublicHost,
  });
  if (!v.ok) {
    return { url: url.trim(), success: false, error: v.error };
  }
  const normalized = v.normalized;
  const parsed = await parseTimingUrl(normalized, context?.driverName ? { driverName: context.driverName } : undefined);
  if (!isImportableParse(parsed)) {
    return {
      url: normalized,
      success: false,
      error: parsed.message ?? "Could not import laps from this URL.",
      parserId: parsed.parserId,
      message: parsed.message ?? null,
      errorCode: parsed.errorCode,
    };
  }

  const rawIso = parsed.sessionCompletedAtIso?.trim();
  let sessionCompletedAt: Date | null = null;
  if (rawIso) {
    const d = new Date(rawIso);
    if (!Number.isNaN(d.getTime())) sessionCompletedAt = d;
  }

  const payload = serializeParsePayload(parsed) as Prisma.InputJsonValue;
  const fieldStats = computeImportedSessionFieldStatsFromParse(parsed);
  const fieldStatsJson: Prisma.InputJsonValue | typeof Prisma.DbNull =
    fieldStats === null ? Prisma.DbNull : (fieldStats as Prisma.InputJsonValue);

  const existing = await prisma.importedLapTimeSession.findFirst({
    where: { userId, sourceUrl: normalized },
    select: { id: true, createdAt: true, sessionCompletedAt: true },
  });

  const row = existing
    ? await prisma.importedLapTimeSession.update({
        where: { id: existing.id },
        data: {
          parserId: parsed.parserId,
          parsedPayload: payload,
          sessionCompletedAt,
          fieldStatsJson,
        },
        select: { id: true, createdAt: true, sessionCompletedAt: true },
      })
    : await prisma.importedLapTimeSession.create({
        data: {
          userId,
          sourceUrl: normalized,
          parserId: parsed.parserId,
          sourceType: inferSourceType(normalized),
          parsedPayload: payload,
          sessionCompletedAt,
          fieldStatsJson,
        },
        select: { id: true, createdAt: true, sessionCompletedAt: true },
      });

  return {
    url: normalized,
    success: true,
    importedSessionId: row.id,
    recordedAt: row.createdAt.toISOString(),
    sessionCompletedAtIso: sessionCompletedAt ? sessionCompletedAt.toISOString() : null,
    sessionCompletedAtDbIso: row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null,
    parserId: parsed.parserId,
    laps: parsed.laps,
    lapRows: parsed.lapRows,
    candidates: parsed.candidates,
    sessionDrivers: parsed.sessionDrivers,
    sessionHint: parsed.sessionHint,
    message: parsed.message ?? null,
    errorCode: parsed.errorCode,
  };
}

/**
 * Attach imported timing session(s) to a run. `Run.importedLapTimeSessionId` is @unique — only one
 * run may reference a given session. We clear that FK on any *other* run for each session id, then
 * set `linkedRunId` on the session and the primary pointer on this run, in one transaction.
 */
export async function linkImportedSessionsToRun(params: {
  userId: string;
  importedLapTimeSessionIds: string[];
  runId: string;
}): Promise<void> {
  const ids = [...new Set(params.importedLapTimeSessionIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;

  await prisma.$transaction(async (tx) => {
    let primaryIdForRun: string | null = null;

    for (const id of ids) {
      await tx.run.updateMany({
        where: {
          userId: params.userId,
          importedLapTimeSessionId: id,
          id: { not: params.runId },
        },
        data: { importedLapTimeSessionId: null },
      });

      const sess = await tx.importedLapTimeSession.findFirst({
        where: { id, userId: params.userId },
        select: { id: true },
      });
      if (!sess) continue;

      await tx.importedLapTimeSession.update({
        where: { id: sess.id },
        data: { linkedRunId: params.runId },
      });

      if (primaryIdForRun == null) {
        primaryIdForRun = id;
      }
    }

    if (primaryIdForRun != null) {
      await tx.run.update({
        where: { id: params.runId, userId: params.userId },
        data: { importedLapTimeSessionId: primaryIdForRun },
      });
    }
  });
}
