/**
 * One-off: delete all SetupSheetCalibration rows except the top 3 "community" calibrations
 * (same selection as refreshCommunitySharedCalibrationsFromEligibleDocs).
 *
 * Run: npx tsx scripts/prune-calibrations-keep-community-shared.ts
 */
import "dotenv/config";
import { SetupDocumentParseStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const MAX_KEEP = 3;

function topCalIdsFromGroup(
  grouped: { calibrationProfileId: string | null; _count: { _all: number } }[]
): string[] {
  return grouped
    .filter(
      (g): g is typeof g & { calibrationProfileId: string } => g.calibrationProfileId != null
    )
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, MAX_KEEP)
    .map((g) => g.calibrationProfileId);
}

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
  return [...seen].slice(0, MAX_KEEP);
}

/** Mirror of refreshCommunitySharedCalibrationsFromEligibleDocs (avoids server-only import). */
async function refreshFlagsAndGetTopIds(): Promise<{
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

async function main() {
  const before = await prisma.setupSheetCalibration.count();
  console.log(`[prune-calibrations] Calibrations before: ${before}`);

  const { topCalibrationIds, resolution } = await refreshFlagsAndGetTopIds();
  console.log(
    `[prune-calibrations] refresh resolution=${resolution} topIds=${topCalibrationIds.join(", ") || "(none)"}`
  );

  let keep = await prisma.setupSheetCalibration.findMany({
    where: { communityShared: true },
    select: { id: true, name: true },
  });

  if (keep.length === 0 && before > 0) {
    const fallback = await prisma.setupSheetCalibration.findMany({
      orderBy: { createdAt: "desc" },
      take: MAX_KEEP,
      select: { id: true, name: true },
    });
    if (fallback.length > 0) {
      await prisma.setupSheetCalibration.updateMany({
        where: { id: { in: fallback.map((f) => f.id) } },
        data: { communityShared: true },
      });
      keep = fallback;
      console.log(
        `[prune-calibrations] No aggregation signals — keeping ${keep.length} most recent as communityShared.`
      );
    }
  }

  if (keep.length === 0) {
    console.log("[prune-calibrations] No calibrations in DB; nothing to do.");
    process.exit(0);
  }

  const keepIds = new Set(keep.map((k) => k.id));
  console.log(
    `[prune-calibrations] Keeping ${keep.length}: ${keep.map((k) => `${k.name} (${k.id})`).join(" | ")}`
  );

  const all = await prisma.setupSheetCalibration.findMany({ select: { id: true } });
  const toDelete = all.map((r) => r.id).filter((id) => !keepIds.has(id));
  if (toDelete.length === 0) {
    console.log("[prune-calibrations] Nothing to delete.");
    process.exit(0);
  }

  await prisma.setupDocument.updateMany({
    where: { parsedCalibrationProfileId: { in: toDelete } },
    data: { parsedCalibrationProfileId: null },
  });
  await prisma.setupDocument.updateMany({
    where: { calibrationResolvedProfileId: { in: toDelete } },
    data: {
      calibrationResolvedProfileId: null,
      calibrationResolvedSource: null,
      calibrationResolvedDebug: null,
    },
  });

  const deleted = await prisma.setupSheetCalibration.deleteMany({
    where: { id: { in: toDelete } },
  });

  const after = await prisma.setupSheetCalibration.count();
  console.log(`[prune-calibrations] Deleted ${deleted.count} calibrations. Remaining: ${after}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
