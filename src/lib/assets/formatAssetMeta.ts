export function formatAssetMeta(stats: {
  runCount: number;
  effectiveTotal: number | null;
}): string {
  const runs = `${stats.runCount} run${stats.runCount === 1 ? "" : "s"}`;
  if (stats.effectiveTotal == null) return runs;
  return `${runs} · total ${stats.effectiveTotal}`;
}
