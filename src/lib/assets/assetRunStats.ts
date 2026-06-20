export type AssetRunStats = {
  runCount: number;
  latestRunNumber: number | null;
  effectiveTotal: number | null;
};

export function effectiveAssetRunTotal(
  initialRunCount: number,
  latestRunNumber: number | null
): number | null {
  if (latestRunNumber == null) {
    return initialRunCount > 0 ? initialRunCount : null;
  }
  return initialRunCount + latestRunNumber;
}

export function buildAssetStatsMap(
  rows: Array<{ assetId: string; runCount: number; latestRunNumber: number | null }>
): Map<string, AssetRunStats> {
  const map = new Map<string, AssetRunStats>();
  for (const row of rows) {
    map.set(row.assetId, {
      runCount: row.runCount,
      latestRunNumber: row.latestRunNumber,
      effectiveTotal: null,
    });
  }
  return map;
}

export function withEffectiveTotals(
  map: Map<string, AssetRunStats>,
  initialRunCounts: Map<string, number>
): Map<string, AssetRunStats> {
  const next = new Map<string, AssetRunStats>();
  for (const [id, stats] of map) {
    const initialRunCount = initialRunCounts.get(id) ?? 0;
    next.set(id, {
      ...stats,
      effectiveTotal: effectiveAssetRunTotal(initialRunCount, stats.latestRunNumber),
    });
  }
  return next;
}
