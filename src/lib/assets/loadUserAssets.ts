import { prisma } from "@/lib/prisma";
import { tireSetDisplayLine } from "@/lib/tires/tireSelectionFromSet";
import { batteryDisplayLabel } from "@/lib/assets/batteryDisplay";
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

const BATTERY_SELECT = {
  id: true,
  label: true,
  packNumber: true,
  initialRunCount: true,
  notes: true,
  createdAt: true,
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

export type UserBatteryListItem = {
  id: string;
  displayLine: string;
  packNumber: number;
  initialRunCount: number;
  notes: string | null;
  createdAt: Date;
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

async function loadBatteryRunStats(userId: string, batteryIds: string[]): Promise<Map<string, AssetRunStats>> {
  if (batteryIds.length === 0) return new Map();

  const grouped = await prisma.run.groupBy({
    by: ["batteryId"],
    where: { userId, batteryId: { in: batteryIds } },
    _count: { id: true },
    _max: { batteryRunNumber: true },
  });

  const base = buildAssetStatsMap(
    grouped
      .filter((row) => row.batteryId != null)
      .map((row) => ({
        assetId: row.batteryId!,
        runCount: row._count.id,
        latestRunNumber: row._max.batteryRunNumber,
      }))
  );

  const initialCounts = new Map(
    (
      await prisma.battery.findMany({
        where: { userId, id: { in: batteryIds } },
        select: { id: true, initialRunCount: true },
      })
    ).map((row) => [row.id, row.initialRunCount] as const)
  );

  const withStats = withEffectiveTotals(base, initialCounts);

  for (const id of batteryIds) {
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
    where: { userId },
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

export async function loadUserBatteriesForList(userId: string): Promise<UserBatteryListItem[]> {
  const batteries = await prisma.battery.findMany({
    where: { userId },
    orderBy: [{ label: "asc" }, { packNumber: "asc" }, { createdAt: "desc" }],
    select: BATTERY_SELECT,
  });

  const statsById = await loadBatteryRunStats(
    userId,
    batteries.map((row) => row.id)
  );

  return batteries.map((row) => ({
    id: row.id,
    displayLine: batteryDisplayLabel(row),
    packNumber: row.packNumber,
    initialRunCount: row.initialRunCount,
    notes: row.notes,
    createdAt: row.createdAt,
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

export async function loadUserBatteryDetail(userId: string, batteryId: string) {
  const battery = await prisma.battery.findFirst({
    where: { id: batteryId, userId },
    select: BATTERY_SELECT,
  });
  if (!battery) return null;

  const statsById = await loadBatteryRunStats(userId, [battery.id]);
  const recentRuns = await prisma.run.findMany({
    where: { userId, batteryId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      batteryRunNumber: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
    },
  });

  return {
    battery,
    displayLine: batteryDisplayLabel(battery),
    stats: statsById.get(battery.id)!,
    recentRuns,
  };
}
