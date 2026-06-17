import { setupSheetModelSlugRank } from "@/lib/setupSheetModels/normalizeModelName";

/**
 * Inputs for electing which duplicate SetupSheetModel row survives a merge.
 * Pure + serializable so the dedupe script and unit tests share one source of truth.
 */
export type DedupeModelRow = {
  id: string;
  name: string;
  slug: string;
  isAuthorized: boolean;
  /** Number of fields in schemaJson — a proxy for "richest" schema. */
  fieldCount: number;
  carCount: number;
  calibrationCount: number;
  documentCount: number;
  /** epoch ms */
  updatedAt: number;
};

export type DedupeGroup = {
  key: string;
  winner: DedupeModelRow;
  losers: DedupeModelRow[];
};

/**
 * Order two rows so the *better* keeper sorts first. Priority:
 *  1. Authorized (curated) beats unverified.
 *  2. Richer schema (more fields).
 *  3. More attached data (cars + 2×calibrations + documents) — calibrations matter most for matching.
 *  4. Canonical slug (no `_N` suffix).
 *  5. Most recently updated.
 *  6. Stable by id.
 */
export function compareDedupeKeeper(a: DedupeModelRow, b: DedupeModelRow): number {
  if (a.isAuthorized !== b.isAuthorized) return a.isAuthorized ? -1 : 1;
  if (a.fieldCount !== b.fieldCount) return b.fieldCount - a.fieldCount;
  const aData = a.carCount + a.calibrationCount * 2 + a.documentCount;
  const bData = b.carCount + b.calibrationCount * 2 + b.documentCount;
  if (aData !== bData) return bData - aData;
  const aRank = setupSheetModelSlugRank(a.slug);
  const bRank = setupSheetModelSlugRank(b.slug);
  if (aRank !== bRank) return aRank - bRank;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function electDedupeWinner(rows: DedupeModelRow[]): DedupeModelRow {
  if (rows.length === 0) throw new Error("electDedupeWinner: empty group");
  return [...rows].sort(compareDedupeKeeper)[0]!;
}

/**
 * Group rows by `keyOf` and elect a keeper per group. Returns only groups that actually need a
 * merge (more than one row), each with the winner and the losers to repoint + delete.
 */
export function planSetupSheetModelDedupe(
  rows: DedupeModelRow[],
  keyOf: (row: DedupeModelRow) => string
): DedupeGroup[] {
  const byKey = new Map<string, DedupeModelRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const groups: DedupeGroup[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const winner = electDedupeWinner(list);
    groups.push({
      key,
      winner,
      losers: list.filter((r) => r.id !== winner.id),
    });
  }
  return groups;
}
