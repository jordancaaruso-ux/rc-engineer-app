import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getLiveRcDriverIdSetting,
  setLiveRcDriverIdSetting,
} from "@/lib/appSettings";
import {
  parseLiveRcRaceResultTableRows,
  type ParsedLiveRcResultRow,
} from "@/lib/lapUrlParsers/livercRaceResult";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

export async function inferLiveRcDriverIdFromRecentImports(
  userId: string,
  driverNorm: string
): Promise<string | null> {
  const rows = await prisma.importedLapTimeSession.findMany({
    where: { userId, sourceType: "liverc" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { parsedPayload: true },
  });
  for (const row of rows) {
    const payload = row.parsedPayload;
    if (!payload || typeof payload !== "object") continue;
    const sessionDrivers = (payload as Record<string, unknown>).sessionDrivers;
    if (!Array.isArray(sessionDrivers)) continue;
    for (const raw of sessionDrivers) {
      if (!raw || typeof raw !== "object") continue;
      const d = raw as { driverName?: string; driverId?: string };
      const id = typeof d.driverId === "string" ? d.driverId.trim() : "";
      if (!id || id.startsWith("sd-")) continue;
      if (normalizeLiveRcDriverNameForMatch(d.driverName ?? "") !== driverNorm) continue;
      return id;
    }
  }
  return null;
}

export function countNameMatchesByDriverId(
  pages: Map<string, ParsedLiveRcResultRow[]>,
  driverNorm: string
): Map<string, number> {
  const sessionCountByDriverId = new Map<string, number>();
  for (const [, rows] of pages) {
    const matchedIds = new Set<string>();
    for (const r of rows) {
      if (normalizeLiveRcDriverNameForMatch(r.driverName) !== driverNorm) continue;
      matchedIds.add(r.driverId);
    }
    for (const id of matchedIds) {
      sessionCountByDriverId.set(id, (sessionCountByDriverId.get(id) ?? 0) + 1);
    }
  }
  return sessionCountByDriverId;
}

export function idAppearsWithName(
  pages: Map<string, ParsedLiveRcResultRow[]>,
  driverId: string,
  driverNorm: string
): boolean {
  for (const rows of pages.values()) {
    if (
      rows.some(
        (r) =>
          r.driverId === driverId && normalizeLiveRcDriverNameForMatch(r.driverName) === driverNorm
      )
    ) {
      return true;
    }
  }
  return false;
}

function pickArgmaxWinners(m: Map<string, number>): string[] {
  let bestN = -1;
  for (const v of m.values()) {
    if (v > bestN) bestN = v;
  }
  if (bestN < 0) return [];
  return [...m.entries()].filter(([, v]) => v === bestN).map(([k]) => k);
}

/** Resolve canonical LiveRC driver id from result pages + settings + import history. */
export async function resolveCanonicalLiveRcDriverId(
  userId: string,
  pageRowsByUrl: Map<string, ParsedLiveRcResultRow[]>,
  driverNorm: string
): Promise<string | null> {
  const sessionCountByDriverId = countNameMatchesByDriverId(pageRowsByUrl, driverNorm);
  const storedId = (await getLiveRcDriverIdSetting(userId).catch(() => null))?.trim() ?? "";
  const bootstrapId = (await inferLiveRcDriverIdFromRecentImports(userId, driverNorm))?.trim() ?? "";

  let canonicalId: string | null = null;

  if (storedId && idAppearsWithName(pageRowsByUrl, storedId, driverNorm)) {
    canonicalId = storedId;
  } else if (bootstrapId && sessionCountByDriverId.has(bootstrapId)) {
    canonicalId = bootstrapId;
  } else if (sessionCountByDriverId.size === 1) {
    canonicalId = [...sessionCountByDriverId.keys()][0]!;
  } else if (sessionCountByDriverId.size > 1) {
    const winners = pickArgmaxWinners(sessionCountByDriverId);
    if (winners.length === 1) {
      canonicalId = winners[0]!;
    } else if (bootstrapId && winners.includes(bootstrapId)) {
      canonicalId = bootstrapId;
    } else if (
      storedId &&
      winners.includes(storedId) &&
      idAppearsWithName(pageRowsByUrl, storedId, driverNorm)
    ) {
      canonicalId = storedId;
    } else if (winners.length > 0) {
      canonicalId = winners.sort()[0]!;
    }
  }

  if (
    canonicalId &&
    !storedId &&
    (sessionCountByDriverId.size === 1 ||
      (pickArgmaxWinners(sessionCountByDriverId).length === 1 &&
        pickArgmaxWinners(sessionCountByDriverId)[0] === canonicalId))
  ) {
    await setLiveRcDriverIdSetting(userId, canonicalId).catch(() => {});
  }

  return canonicalId;
}

export { parseLiveRcRaceResultTableRows };
