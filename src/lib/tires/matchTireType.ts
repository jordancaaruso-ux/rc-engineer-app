export type TireTypeRecord = {
  id: string;
  displayName: string;
  modelCode: string;
};

/** Normalize tire text for fuzzy comparison. */
export function normalizeTireText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s*#\s*\d+\s*$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const aCompact = a.replace(/\s+/g, "");
  const bCompact = b.replace(/\s+/g, "");
  if (aCompact === bCompact) return 95;
  if (a.includes(b) || b.includes(a)) return 85;
  if (aCompact.includes(bCompact) || bCompact.includes(aCompact)) return 82;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = b.split(" ").filter(Boolean);
  if (bTokens.length === 0) return 0;
  let hits = 0;
  for (const t of bTokens) {
    if (aTokens.has(t)) hits++;
  }
  const ratio = hits / bTokens.length;
  return Math.round(ratio * 70);
}

export function scoreTireTypeMatch(query: string, tireType: TireTypeRecord): number {
  const q = normalizeTireText(query);
  if (!q) return 0;
  const name = normalizeTireText(tireType.displayName);
  const code = normalizeTireText(tireType.modelCode);
  const nameScore = tokenOverlapScore(name, q);
  const codeScore = tokenOverlapScore(code, q);
  if (name === q || code === q) return 100;
  return Math.max(nameScore, codeScore);
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
