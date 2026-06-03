/** Normalize driver names for Speedhive classification matching (same approach as LiveRC). */
export function normalizeSpeedhiveDriverNameForMatch(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function speedhiveDriverNameMatches(
  rowName: string,
  driverNorm: string
): boolean {
  const normRow = normalizeSpeedhiveDriverNameForMatch(rowName);
  if (!driverNorm || !normRow) return false;
  if (normRow === driverNorm) return true;
  const tokens = driverNorm.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 2) return false;
  return tokens.every((t) => normRow.includes(t));
}
