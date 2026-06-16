/** Normalize display name for duplicate detection (e.g. "Mugen MTC3" ≈ "mugen mtc3"). */
export function normalizeSetupSheetModelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer canonical slug (no `_1` suffix) when picking one row among duplicates. */
export function setupSheetModelSlugRank(slug: string): number {
  if (!/_\d+$/.test(slug)) return 0;
  const m = slug.match(/_(\d+)$/);
  return m ? Number(m[1]) : 99;
}
