import "server-only";

import { prisma } from "@/lib/prisma";
import { parseTimingUrl } from "@/lib/lapUrlParsers/registry";
import { importOneTimingUrl } from "@/lib/lapImport/service";

export type WatchCheckResultRow =
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "new_imported";
      importedSessionId: string;
      sessionCompletedAtIso: string | null;
      parserId: string;
      message: string | null;
    }
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "no_change";
      sessionCompletedAtIso: string | null;
      parserId: string;
      message: string | null;
    }
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "error";
      error: string;
      parserId: string | null;
    };

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function checkWatchedLapSources(params: {
  userId: string;
  forceImport?: boolean;
}): Promise<WatchCheckResultRow[]> {
  const sources = await prisma.watchedLapSource.findMany({
    where: { userId: params.userId },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      sourceUrl: true,
      driverName: true,
      carId: true,
      lastSeenSessionCompletedAt: true,
    },
  });

  const out: WatchCheckResultRow[] = [];
  for (const s of sources) {
    try {
      const parsed = await parseTimingUrl(s.sourceUrl, s.driverName ? { driverName: s.driverName } : undefined);
      const whenIso = parsed.sessionCompletedAtIso?.trim() ? parsed.sessionCompletedAtIso.trim() : null;
      const when = whenIso ? new Date(whenIso) : null;
      const whenOk = when != null && !Number.isNaN(when.getTime());

      const lastSeen = s.lastSeenSessionCompletedAt;
      const isNew =
        params.forceImport === true ||
        (whenOk && (lastSeen == null || when!.getTime() > lastSeen.getTime()));

      if (!isNew) {
        await prisma.watchedLapSource.update({
          where: { id: s.id },
          data: { lastCheckedAt: new Date() },
        });
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "no_change",
          sessionCompletedAtIso: whenOk ? when!.toISOString() : null,
          parserId: parsed.parserId,
          message: parsed.message ?? null,
        });
        continue;
      }

      const imported = await importOneTimingUrl(params.userId, s.sourceUrl, s.driverName ? { driverName: s.driverName } : undefined);
      if (imported.success !== true) {
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "error",
          error: imported.error,
          parserId: imported.parserId ?? null,
        });
        continue;
      }

      await prisma.watchedLapSource.update({
        where: { id: s.id },
        data: {
          lastCheckedAt: new Date(),
          lastSeenSessionCompletedAt: whenOk ? when! : undefined,
        },
      });

      out.push({
        sourceId: s.id,
        sourceUrl: s.sourceUrl,
        driverName: s.driverName ?? null,
        carId: s.carId ?? null,
        status: "new_imported",
        importedSessionId: imported.importedSessionId,
        sessionCompletedAtIso: imported.sessionCompletedAtIso ?? (whenOk ? when!.toISOString() : null),
        parserId: imported.parserId,
        message: imported.message ?? null,
      });
    } catch (e) {
      await prisma.watchedLapSource.update({
        where: { id: s.id },
        data: { lastCheckedAt: new Date() },
      });
      out.push({
        sourceId: s.id,
        sourceUrl: s.sourceUrl,
        driverName: s.driverName ?? null,
        carId: s.carId ?? null,
        status: "error",
        error: e instanceof Error ? e.message : "Watch check failed",
        parserId: null,
      });
    }
  }
  return out;
}

