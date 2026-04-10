import "server-only";

import { prisma } from "@/lib/prisma";
import { primaryLapRowsFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";

export type EnrichedImportedForWatch = {
  importedSessionId: string;
  /** Session timing URL stored on ImportedLapTimeSession (canonical for this import). */
  timingSourceUrl: string;
  /** Driver label from parsed payload (same logic as Lap import library list). */
  displayDriverName: string;
  /** ISO instant for labels (payload → DB session time → import createdAt). */
  sessionCompletedAtIso: string;
  lapCount: number | null;
  bestLapSeconds: number | null;
};

/**
 * Load owner-scoped ImportedLapTimeSession and derive the same display fields as the lap import workspace.
 * Ensures watched-source check rows match canonical imported-session identity and metadata.
 */
export async function enrichImportedSessionForWatch(
  userId: string,
  importedSessionId: string,
  options?: { sessionCompletedAtIsoFromDiscovery?: string | null }
): Promise<EnrichedImportedForWatch | null> {
  const row = await prisma.importedLapTimeSession.findFirst({
    where: { id: importedSessionId, userId },
    select: {
      id: true,
      sourceUrl: true,
      sessionCompletedAt: true,
      createdAt: true,
      parsedPayload: true,
    },
  });
  if (!row) return null;

  const parsed = row.parsedPayload;
  const primary = primaryLapRowsFromImportedPayload(parsed);
  const lapTimes = (primary?.rows ?? []).map((l) => l.lapTimeSeconds).filter((n): n is number => Number.isFinite(n));
  const bestLapSeconds = lapTimes.length > 0 ? Math.min(...lapTimes) : null;

  const sessionCompletedAtIso = resolveImportedSessionDisplayTimeIso({
    sessionCompletedAt: row.sessionCompletedAt,
    parsedPayload: parsed,
    createdAt: row.createdAt,
    sessionCompletedAtIsoHint: options?.sessionCompletedAtIsoFromDiscovery ?? null,
  });

  return {
    importedSessionId: row.id,
    timingSourceUrl: row.sourceUrl,
    displayDriverName: primary?.driverName?.trim() || "Session",
    sessionCompletedAtIso,
    lapCount: lapTimes.length > 0 ? lapTimes.length : null,
    bestLapSeconds,
  };
}
