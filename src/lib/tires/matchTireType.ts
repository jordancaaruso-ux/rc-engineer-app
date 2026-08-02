import { normalizeSearchText, scoreSearchMatch } from "@/lib/search/optionSearch";

export type TireTypeRecord = {
  id: string;
  displayName: string;
  modelCode: string;
};

/**
 * Normalize tire text for fuzzy comparison.
 *
 * Re-exported rather than reimplemented: the picker sheets, the setup-sheet
 * auto-match and this matcher all have to agree on what "Sweep 32 #2" reduces
 * to, or the same typed string ranks differently depending on where it was
 * typed. See `@/lib/search/optionSearch`.
 */
export function normalizeTireText(input: string): string {
  return normalizeSearchText(input);
}

export function scoreTireTypeMatch(query: string, tireType: TireTypeRecord): number {
  return scoreSearchMatch(query, [tireType.displayName, tireType.modelCode]);
}

export const TIRE_TYPE_AUTO_MATCH_THRESHOLD = 72;

export type TireTypeMatch = {
  tireType: TireTypeRecord;
  score: number;
};

/** Rank catalog entries against free-text query. */
export function matchTireTypes(
  query: string,
  catalog: TireTypeRecord[],
  limit = 8
): TireTypeMatch[] {
  const q = query.trim();
  if (!q || catalog.length === 0) return [];
  const scored = catalog
    .map((tireType) => ({ tireType, score: scoreTireTypeMatch(q, tireType) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.tireType.displayName.localeCompare(b.tireType.displayName));
  return scored.slice(0, limit);
}

export function bestTireTypeMatch(
  query: string,
  catalog: TireTypeRecord[],
  threshold = TIRE_TYPE_AUTO_MATCH_THRESHOLD
): TireTypeRecord | null {
  const matches = matchTireTypes(query, catalog, 1);
  const top = matches[0];
  if (!top || top.score < threshold) return null;
  return top.tireType;
}

/** Suggest model code from display name (user can edit before create). */
export function suggestModelCodeFromDisplayName(displayName: string): string {
  const base = displayName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "TIRE";
}
