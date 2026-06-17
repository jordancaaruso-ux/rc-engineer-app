import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

export type KbChunkIndexEntry = {
  sourcePath: string;
  title: string;
  sectionSlug: string;
  excerpt: string;
  /** Lowercased tokens for bag-of-words retrieval. */
  tokens: string[];
};

const INDEX_PATH = path.join(process.cwd(), "content", "vehicle-dynamics", ".chunk-index.json");

let cachedIndex: KbChunkIndexEntry[] | null = null;

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_\-+.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreTokens(queryTokens: string[], entryTokens: string[]): number {
  const set = new Set(entryTokens);
  let s = 0;
  for (const t of queryTokens) {
    if (set.has(t)) s += 1;
    else if ([...set].some((e) => e.includes(t) || t.includes(e))) s += 0.5;
  }
  return s;
}

async function loadIndex(): Promise<KbChunkIndexEntry[]> {
  if (cachedIndex) return cachedIndex;
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw) as { chunks?: KbChunkIndexEntry[] };
    cachedIndex = Array.isArray(parsed.chunks) ? parsed.chunks : [];
  } catch {
    cachedIndex = [];
  }
  return cachedIndex;
}

/**
 * Search pre-built KB chunk index (Phase 6). Falls back to empty when index missing —
 * callers should use searchVehicleDynamicsKb as backup.
 */
export async function searchKbChunkIndex(
  query: string,
  limit: number
): Promise<KbChunkIndexEntry[]> {
  const index = await loadIndex();
  if (index.length === 0) return [];
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  return index
    .map((entry) => ({ entry, score: scoreTokens(qTokens, entry.tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.entry);
}

/** @internal test helper */
export function clearKbChunkIndexCache(): void {
  cachedIndex = null;
}
