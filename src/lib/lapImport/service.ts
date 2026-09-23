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
    sessionUtcOffsetMinutes: parsed.sessionUtcOffsetMinutes ?? null,
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
  /** Speedhive practice: the track's offset from UTC when the session ran (see `LapUrlParseResult`). */
  sessionUtcOffsetMinutes: number | null;
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
    /**
     * The driver pasted this exact link themselves: a session they deleted comes back. Every
     * automatic caller (the sweep, event detection, watched links) leaves it out, which is what
     * keeps a deleted session deleted.
     */
    restoreIfHidden?: boolean;
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

  // One row per (user, URL) — enforced by the unique index, so a sweep tick and a wizard
  // import racing on the same session converge on one row instead of minting two.
  const row = await prisma.importedLapTimeSession.upsert({
    where: { userId_sourceUrl: { userId, sourceUrl: normalized } },
    update: {
      parserId: parsed.parserId,
      parsedPayload: payload,
      sessionCompletedAt,
      fieldStatsJson,
      ...(context?.restoreIfHidden ? { hiddenAt: null } : {}),
    },
    create: {
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
    sessionUtcOffsetMinutes: parsed.sessionUtcOffsetMinutes ?? null,
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
 *
 * `sameOutingImportedLapTimeSessionIds` are other timing sites' copies of those
 * races (the lap step's linked sources, `lapImport/sameOutingBlocks.ts`): linked
 * to the run like the rest, so the day never files them as runs of their own,
 * but never its primary — the run's session time and field come from its laps.
 * They only ride along with laps: with no sessions attached they detach too.
 */
export async function linkImportedSessionsToRun(params: {
  userId: string;
  importedLapTimeSessionIds: string[];
  sameOutingImportedLapTimeSessionIds?: string[];
  runId: string;
}): Promise<void> {
  const ids = [...new Set(params.importedLapTimeSessionIds.map((id) => id.trim()).filter(Boolean))];
  const copyIds =
    ids.length === 0
      ? []
      : [
          ...new Set(
            (params.sameOutingImportedLapTimeSessionIds ?? [])
              .map((id) => id.trim())
              .filter((id) => id.length > 0 && !ids.includes(id))
          ),
        ];
  const allIds = [...ids, ...copyIds];

  await prisma.$transaction(async (tx) => {
    // Detach first: a session dropped from this run must let go before we choose
    // a primary, or a stale row could still be holding the @unique pointer.
    await tx.importedLapTimeSession.updateMany({
      where: {
        userId: params.userId,
        linkedRunId: params.runId,
        ...(allIds.length > 0 ? { id: { notIn: allIds } } : {}),
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

    // A placeholder is never precious. If the app filed a run for one of these sessions and a
    // human run now claims it (a late-opened draft picking the session on the lap step), the
    // placeholder dissolves — its laps are the same laps, now on the run the driver made. A run
    // the driver confirmed is never touched here; it only loses the primary pointer below.
    const placeholders = await tx.run.findMany({
      where: {
        userId: params.userId,
        importedLapTimeSessionId: { in: allIds },
        id: { not: params.runId },
        unconfirmedAt: { not: null },
      },
      select: { id: true },
    });
    if (placeholders.length > 0) {
      await tx.run.deleteMany({ where: { id: { in: placeholders.map((p) => p.id) } } });
    }

    for (const id of allIds) {
      await tx.run.updateMany({
        where: {
          userId: params.userId,
          importedLapTimeSessionId: id,
          id: { not: params.runId },
        },
        data: { importedLapTimeSessionId: null },
      });
    }

    const ownedAll = await tx.importedLapTimeSession.findMany({
      where: { id: { in: allIds }, userId: params.userId },
      select: { id: true, sessionCompletedAt: true, createdAt: true },
    });
    const owned = ownedAll.filter((s) => ids.includes(s.id));
    if (owned.length === 0) return;

    // A session the driver puts on a run is in use again, whatever they deleted before.
    await tx.importedLapTimeSession.updateMany({
      where: { id: { in: ownedAll.map((s) => s.id) }, userId: params.userId },
      data: { linkedRunId: params.runId, hiddenAt: null },
    });

    // Earliest on track wins the primary pointer, so the run's session time and
    // field stats come from the first half however the client ordered the list.
    // Copies never do: they are the same race, and the laps are not theirs.
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
