/** Merge fetched asset rows with in-session additions (preserve ids only in `prev`). */
export function mergeUniqueById<T extends { id: string }>(prev: T[], fetched: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of fetched) byId.set(row.id, row);
  for (const row of prev) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}
