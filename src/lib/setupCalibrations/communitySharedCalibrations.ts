import "server-only";

import { SetupDocumentParseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_COMMUNITY_SHARED = 3;

function topCalIdsFromGroup(
  grouped: { calibrationProfileId: string | null; _count: { _all: number } }[]
): string[] {
  return grouped
    .filter(
      (g): g is typeof g & { calibrationProfileId: string } => g.calibrationProfileId != null
    )
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, MAX_COMMUNITY_SHARED)
    .map((g) => g.calibrationProfileId);
}

/**
 * Distinct calibrationProfileIds in the most recently updated **bulk import batch** (documents with
 * a calibration), in stable order, when nothing else is available.
 */
async function topCalibrationIdsFromLatestBulkImportBatch(): Promise<string[]> {
  const batch = await prisma.setupImportBatch.findFirst({
    where: { documents: { some: { calibrationProfileId: { not: null } } } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, calibrationProfileId: true },
  });
  if (!batch) return [];
  const seen = new Set<string>();
  if (batch.calibrationProfileId) seen.add(batch.calibrationProfileId);
  const docs = await prisma.setupDocument.findMany({
    where: { setupImportBatchId: batch.id, calibrationProfileId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { calibrationProfileId: true },
  });
  for (const d of docs) {
    if (d.calibrationProfileId) seen.add(d.calibrationProfileId);
  }
  return [...seen].slice(0, MAX_COMMUNITY_SHARED);
}

/**
 * Recomputes which calibrations are **community shared** (max {MAX_COMMUNITY_SHARED} rows).
 * Priority:
 * 1) Top by count among `eligibleForAggregationDataset` (aggregation lane).
 * 2) If none, top by count among **parsed** non-pending setup documents with a calibration (typical
 *    bulk or single uploads that have not been marked aggregation-eligible yet).
 * 3) If still none, the distinct calibration profile ids on the **most recently updated** bulk
 *    import batch (last bulk-upload lane) — so new deployments still expose something after another
 *    user has used bulk import.
 * Call after community aggregation rebuild (also safe to re-run; idempotent for flags).
 */
export async function refreshCommunitySharedCalibrationsFromEligibleDocs(): Promise<{
  topCalibrationIds: string[];
  resolution: "eligible" | "parsed_docs" | "latest_bulk_batch" | "none";
}> {
  const fromEligible = await prisma.setupDocument.groupBy({
    by: ["calibrationProfileId"],
    where: {
      eligibleForAggregationDataset: true,
      calibrationProfileId: { not: null },
    },
    _count: { _all: true },
  });
  let topIds = topCalIdsFromGroup(fromEligible);
  let resolution: "eligible" | "parsed_docs" | "latest_bulk_batch" | "none" = "none";

  if (topIds.length > 0) {
    resolution = "eligible";
  } else {
    const fromParsed = await prisma.setupDocument.groupBy({
      by: ["calibrationProfileId"],
      where: {
        calibrationProfileId: { not: null },
        parseStatus: { in: [SetupDocumentParseStatus.PARSED, SetupDocumentParseStatus.PARTIAL] },
      },
      _count: { _all: true },
    });
    topIds = topCalIdsFromGroup(fromParsed);
    if (topIds.length > 0) {
      resolution = "parsed_docs";
    }
  }

  if (topIds.length === 0) {
    topIds = await topCalibrationIdsFromLatestBulkImportBatch();
    if (topIds.length > 0) resolution = "latest_bulk_batch";
  }

  await prisma.$transaction([
    prisma.setupSheetCalibration.updateMany({
      where: { communityShared: true },
      data: { communityShared: false },
    }),
    ...(topIds.length > 0
      ? [
          prisma.setupSheetCalibration.updateMany({
            where: { id: { in: topIds } },
            data: { communityShared: true },
          }),
        ]
      : []),
  ]);

  return { topCalibrationIds: topIds, resolution };
}

/**
 * When the DB has no community-shared rows yet, run {@link refreshCommunitySharedCalibrationsFromEligibleDocs}
 * once (e.g. first visit to a page that lists calibrations, or first GET to the list API) so new accounts
 * can see shared calibrations without running a full aggregation rebuild first.
 */
export async function ensureCommunitySharedCalibrationsIfEmpty(): Promise<void> {
  const n = await prisma.setupSheetCalibration.count({ where: { communityShared: true } });
  if (n > 0) return;
  await refreshCommunitySharedCalibrationsFromEligibleDocs().catch((e) => {
    console.error("[ensureCommunitySharedCalibrationsIfEmpty]", e);
  });
}
