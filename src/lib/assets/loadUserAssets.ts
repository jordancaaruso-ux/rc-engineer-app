import { prisma } from "@/lib/prisma";
import { tireSetDisplayLine } from "@/lib/tires/tireSelectionFromSet";
import {
  type AssetRunStats,
  buildAssetStatsMap,
  effectiveAssetRunTotal,
  withEffectiveTotals,
} from "@/lib/assets/assetRunStats";

const TIRE_SET_SELECT = {
  id: true,
  label: true,
  setNumber: true,
  initialRunCount: true,
  insertLabel: true,
  wheelLabel: true,
  specificModel: true,
  notes: true,
  createdAt: true,
  tireTypeId: true,
  tireType: { select: { id: true, displayName: true, modelCode: true } },
} as const;

export type UserTireSetListItem = {
  id: string;
  displayLine: string;
  setNumber: number;
  initialRunCount: number;
  notes: string | null;
  createdAt: Date;
  tireType: { id: string; displayName: string; modelCode: string } | null;
  stats: AssetRunStats;
};

async function loadTireSetRunStats(userId: string, tireSetIds: string[]): Promise<Map<string, AssetRunStats>> {
  if (tireSetIds.length === 0) return new Map();

  const grouped = await prisma.run.groupBy({
    by: ["tireSetId"],
    where: { userId, tireSetId: { in: tireSetIds } },
    _count: { id: true },
    _max: { tireRunNumber: true },
  });

  const base = buildAssetStatsMap(
    grouped
      .filter((row) => row.tireSetId != null)
      .map((row) => ({
        assetId: row.tireSetId!,
        runCount: row._count.id,
        latestRunNumber: row._max.tireRunNumber,
      }))
  );

  const initialCounts = new Map(
    (
      await prisma.tireSet.findMany({
        where: { userId, id: { in: tireSetIds } },
        select: { id: true, initialRunCount: true },
      })
    ).map((row) => [row.id, row.initialRunCount] as const)
  );

  const withStats = withEffectiveTotals(base, initialCounts);

  for (const id of tireSetIds) {
    if (!withStats.has(id)) {
      const initialRunCount = initialCounts.get(id) ?? 0;
      withStats.set(id, {
        runCount: 0,
        latestRunNumber: null,
        effectiveTotal: effectiveAssetRunTotal(initialRunCount, null),
      });
    }
  }

  return withStats;
}

export async function loadUserTireSetsForList(userId: string): Promise<UserTireSetListItem[]> {
  const tireSets = await prisma.tireSet.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ label: "asc" }, { setNumber: "asc" }, { createdAt: "desc" }],
    select: TIRE_SET_SELECT,
  });

  const statsById = await loadTireSetRunStats(
    userId,
    tireSets.map((row) => row.id)
  );

  return tireSets.map((row) => ({
    id: row.id,
    displayLine: tireSetDisplayLine(row),
    setNumber: row.setNumber,
    initialRunCount: row.initialRunCount,
    notes: row.notes,
    createdAt: row.createdAt,
    tireType: row.tireType,
    stats: statsById.get(row.id) ?? {
      runCount: 0,
      latestRunNumber: null,
      effectiveTotal: effectiveAssetRunTotal(row.initialRunCount, null),
    },
  }));
}

export async function loadUserTireSetDetail(userId: string, tireSetId: string) {
  const tireSet = await prisma.tireSet.findFirst({
    where: { id: tireSetId, userId },
    select: TIRE_SET_SELECT,
  });
  if (!tireSet) return null;

  const statsById = await loadTireSetRunStats(userId, [tireSet.id]);
  const recentRuns = await prisma.run.findMany({
    where: { userId, tireSetId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      tireRunNumber: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
    },
  });

  return {
    tireSet,
    displayLine: tireSetDisplayLine(tireSet),
    stats: statsById.get(tireSet.id)!,
    recentRuns,
  };
}
