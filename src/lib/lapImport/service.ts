import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LapUrlParseResult } from "@/lib/lapUrlParsers/types";
import { parseTimingUrl } from "@/lib/lapUrlParsers/registry";

export function validateTimingHttpUrl(
  url: string
): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "url is required" };
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "URL must be http(s)" };
    }
    return { ok: true, normalized: trimmed };
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
}

export function inferSourceType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("liverc") || u.includes("live-rc")) return "liverc";
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
  context?: { driverName?: string }
): Promise<ImportOneUrlResult> {
  const v = validateTimingHttpUrl(url);
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
  const row = await prisma.importedLapTimeSession.create({
    data: {
      userId,
      sourceUrl: normalized,
      parserId: parsed.parserId,
      sourceType: inferSourceType(normalized),
      parsedPayload: serializeParsePayload(parsed) as Prisma.InputJsonValue,
      sessionCompletedAt,
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

export async function linkImportedSessionToRun(params: {
  userId: string;
  importedLapTimeSessionId: string;
  runId: string;
}): Promise<boolean> {
  const sess = await prisma.importedLapTimeSession.findFirst({
    where: { id: params.importedLapTimeSessionId, userId: params.userId },
    select: { id: true, linkedRunId: true },
  });
  if (!sess) return false;
  if (sess.linkedRunId != null && sess.linkedRunId !== params.runId) return false;
  await prisma.importedLapTimeSession.update({
    where: { id: sess.id },
    data: { linkedRunId: params.runId },
  });
  return true;
}

export async function linkImportedSessionsToRun(params: {
  userId: string;
  importedLapTimeSessionIds: string[];
  runId: string;
}): Promise<void> {
  const ids = [...new Set(params.importedLapTimeSessionIds.map((id) => id.trim()).filter(Boolean))];
  for (const id of ids) {
    await linkImportedSessionToRun({
      userId: params.userId,
      importedLapTimeSessionId: id,
      runId: params.runId,
    });
  }
}
