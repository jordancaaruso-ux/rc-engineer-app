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
  if (u.includes("myrcm.ch")) return "myrcm";
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
    discoveredSessions: parsed.discoveredSessions ?? null,
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
  context?: {
    driverName?: string;
    speedhiveDriverNames?: string[];
    speedhiveTransponderNumbers?: number[];
    allowAnyPublicHost?: boolean;
  }
): Promise<ImportOneUrlResult> {
  const v = await validateTimingHttpUrlResolved(url, {
    allowAnyPublicHost: context?.allowAnyPublicHost,
  });
  if (!v.ok) {
    return { url: url.trim(), success: false, error: v.error };
  }
  const normalized = v.normalized;
  // Forward every identity the caller resolved. `speedhiveDriverNames` is read by exactly one
  // parser; dropping it here silently costs that parser its only way of telling the driver's row
  // apart from the rest of the field.
  const parseContext =
    context &&
    (context.driverName ||
      (context.speedhiveDriverNames?.length ?? 0) > 0 ||
      (context.speedhiveTransponderNumbers?.length ?? 0) > 0)
      ? {
          ...(context.driverName ? { driverName: context.driverName } : {}),
          ...(context.speedhiveDriverNames?.length
            ? { speedhiveDriverNames: context.speedhiveDriverNames }
            : {}),
          ...(context.speedhiveTransponderNumbers?.length
            ? { speedhiveTransponderNumbers: context.speedhiveTransponderNumbers }
            : {}),
        }
      : undefined;
  const parsed = await parseTimingUrl(normalized, parseContext);
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
 * Set the timing session(s) attached to a run — the full list, not an addition.
 *
 * A run may hold several: a session split by a quick break comes back from the
 * timing site as two entries, and the driver attaches both. `linkedRunId` on the
 * session carries that many-to-one link; `Run.importedLapTimeSessionId` is
 * @unique and points at the *primary* (earliest on track), which is what the
 * session-time fallback and the Engineer's field stats read.
 *
 * This is a replace, so anything the driver removed in the form is detached
 * here. Before multi-attach, clearing an import left the session still claiming
 * the run — harmless when only one could ever be attached, wrong the moment
 * "remove just this one" exists. An empty list is therefore a real instruction
 * (detach everything), not a no-op.
 */
export async function linkImportedSessionsToRun(params: {
  userId: string;
  importedLapTimeSessionIds: string[];
  runId: string;
}): Promise<void> {
  const ids = [...new Set(params.importedLapTimeSessionIds.map((id) => id.trim()).filter(Boolean))];

  await prisma.$transaction(async (tx) => {
    // Detach first: a session dropped from this run must let go before we choose
    // a primary, or a stale row could still be holding the @unique pointer.
    await tx.importedLapTimeSession.updateMany({
      where: {
        userId: params.userId,
        linkedRunId: params.runId,
        ...(ids.length > 0 ? { id: { notIn: ids } } : {}),
      },
      data: { linkedRunId: null },
    });

    if (ids.length === 0) {
      await tx.run.updateMany({
        where: { id: params.runId, userId: params.userId },
        data: { importedLapTimeSessionId: null },
      });
      return;
    }

    for (const id of ids) {
      await tx.run.updateMany({
        where: {
          userId: params.userId,
          importedLapTimeSessionId: id,
          id: { not: params.runId },
        },
        data: { importedLapTimeSessionId: null },
      });
    }

    const owned = await tx.importedLapTimeSession.findMany({
      where: { id: { in: ids }, userId: params.userId },
      select: { id: true, sessionCompletedAt: true, createdAt: true },
    });
    if (owned.length === 0) return;

    await tx.importedLapTimeSession.updateMany({
      where: { id: { in: owned.map((s) => s.id) }, userId: params.userId },
      data: { linkedRunId: params.runId },
    });

    // Earliest on track wins the primary pointer, so the run's session time and
    // field stats come from the first half however the client ordered the list.
    const primaryIdForRun = [...owned].sort(
      (a, b) =>
        (a.sessionCompletedAt ?? a.createdAt).getTime() -
        (b.sessionCompletedAt ?? b.createdAt).getTime()
    )[0]!.id;

    await tx.run.update({
      where: { id: params.runId, userId: params.userId },
      data: { importedLapTimeSessionId: primaryIdForRun },
    });
  });
}
