/**
 * Picks up to `max` run ids starting at `primaryRunId` in a list already ordered
 * newest-first (sortAt desc, createdAt desc on the car).
 */
export function selectChronoRecentRunIds(
  orderedNewestFirst: readonly { id: string }[],
  primaryRunId: string,
  max: number
): string[] {
  if (max < 1) return [];
  const idx = orderedNewestFirst.findIndex((r) => r.id === primaryRunId);
  if (idx < 0) return [primaryRunId];
  return orderedNewestFirst.slice(idx, idx + max).map((r) => r.id);
}
