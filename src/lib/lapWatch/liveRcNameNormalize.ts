/** Deterministic comparison for session-list driver filtering (no fuzzy matching). Safe for client bundles. */
export function normalizeLiveRcDriverNameForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
