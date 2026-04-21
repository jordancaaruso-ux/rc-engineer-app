import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

const KB_DIR = path.join(process.cwd(), "content", "vehicle-dynamics");

export type VehicleDynamicsKbSnippet = {
  /** File path relative to content/vehicle-dynamics */
  sourcePath: string;
  /** First heading or filename */
  title: string;
  excerpt: string;
};

/** Weights used by the bag-of-words scorer. Higher weight = stronger signal for ranking. */
const WEIGHT_TITLE = 3;
const WEIGHT_KEY_LINE = 3;
const WEIGHT_BODY = 1;

/** Cap on how many canonical-key guaranteed-coverage inserts we make per query. */
const MAX_GUARANTEE_ADDS = 6;

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_\-+.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * Count unique matching tokens weighted by where they appeared: title or `**Key[s]:**`
 * lines score higher than body prose. Returns the total weighted score for the chunk.
 */
function scoreChunk(
  title: string,
  keyLine: string,
  body: string,
  tokens: string[]
): number {
  const titleLower = title.toLowerCase();
  const keyLower = keyLine.toLowerCase();
  const bodyLower = body.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (titleLower.includes(t)) {
      s += WEIGHT_TITLE;
      continue;
    }
    if (keyLower.includes(t)) {
      s += WEIGHT_KEY_LINE;
      continue;
    }
    if (bodyLower.includes(t)) {
      s += WEIGHT_BODY;
    }
  }
  return s;
}

/**
 * Extract canonical parameter keys from a chunk's `**Key:**` / `**Keys:**` / `**Keys (examples):**`
 * lines. Keys live inside backticks in the KB convention
 * (e.g. `**Keys:** \`toe_rear\`, \`camber_rear\``), so we pull every backtick-wrapped token out
 * of any matching line. Used for the guaranteed-coverage pass.
 */
function extractKeyTokens(body: string): Set<string> {
  const keys = new Set<string>();
  const lines = body.split("\n");
  for (const line of lines) {
    if (!/\*\*Keys?(?:\s*\([^)]*\))?:\*\*/.test(line)) continue;
    const backticked = line.match(/`([^`]+)`/g);
    if (!backticked) continue;
    for (const raw of backticked) {
      const inner = raw.slice(1, -1).trim().toLowerCase();
      if (inner.length >= 2) keys.add(inner);
    }
  }
  return keys;
}

/**
 * Find all `**Key[s]:**` lines in a chunk body and join them into a single string used for
 * weighted scoring — so a token matching the Key line counts as a strong signal regardless of
 * how many times it appears in body prose.
 */
function extractKeyLine(body: string): string {
  const lines = body.split("\n");
  const keep: string[] = [];
  for (const line of lines) {
    if (/\*\*Keys?(?:\s*\([^)]*\))?:\*\*/.test(line)) keep.push(line);
  }
  return keep.join("\n");
}

type ScoredChunk = {
  score: number;
  keyTokens: Set<string>;
  snippet: VehicleDynamicsKbSnippet;
};

/**
 * Keyword search over markdown files in `content/vehicle-dynamics/`.
 * Sections split on `##` headings. Two-phase ranking:
 *   1. Weighted bag-of-words: title/Key-line matches are scored 3× over body prose
 *      so canonical parameter sections win ties against prose that merely repeats
 *      common tokens like "rear" or "grip".
 *   2. Guaranteed-coverage pass: after the top-K selection, any canonical parameter
 *      key that appears in the query tokens AND in some chunk's Key line is
 *      guaranteed at least one representative chunk in the final result. Evicts the
 *      lowest-scoring non-guaranteed chunk to make room, up to MAX_GUARANTEE_ADDS.
 */
export async function searchVehicleDynamicsKb(
  query: string,
  limit: number
): Promise<VehicleDynamicsKbSnippet[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  let files: string[] = [];
  try {
    files = (await fs.readdir(KB_DIR)).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
  } catch {
    return [];
  }

  const scored: ScoredChunk[] = [];

  for (const file of files) {
    const full = path.join(KB_DIR, file);
    let raw = "";
    try {
      raw = await fs.readFile(full, "utf8");
    } catch {
      continue;
    }
    const chunks: Array<{ title: string; body: string }> = [];
    if (/\n##\s/.test(raw)) {
      const parts = raw.split(/\n(?=##\s)/);
      for (const part of parts) {
        const lines = part.trim().split("\n");
        const titleLine = lines[0]?.replace(/^#+\s*/, "").trim() || file;
        const body = lines.slice(1).join("\n").trim();
        chunks.push({ title: titleLine, body });
      }
    } else {
      chunks.push({ title: file.replace(/\.md$/i, ""), body: raw.trim() });
    }
    for (const { title, body } of chunks) {
      const keyLine = extractKeyLine(body);
      const keyTokens = extractKeyTokens(body);
      const sc = scoreChunk(title, keyLine, body, tokens);
      if (sc <= 0) continue;
      const text = `${title}\n${body}`;
      const excerpt = text.length > 900 ? `${text.slice(0, 897)}…` : text;
      scored.push({
        score: sc,
        keyTokens,
        snippet: {
          sourcePath: `vehicle-dynamics/${file}`,
          title: title.length > 80 ? `${title.slice(0, 77)}…` : title,
          excerpt,
        },
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Phase 1: initial top-K selection.
  const selected: ScoredChunk[] = scored.slice(0, limit);
  const selectedIdxSet = new Set<number>();
  for (let i = 0; i < Math.min(limit, scored.length); i++) selectedIdxSet.add(i);

  // Phase 2: guaranteed-coverage pass.
  // Union of canonical keys across the entire KB — any of these appearing in the query
  // is a canonical parameter the user asked about.
  const universeKeys = new Set<string>();
  for (const c of scored) for (const k of c.keyTokens) universeKeys.add(k);

  const queryTokenSet = new Set(tokens);
  const queriedCanonicalKeys: string[] = [];
  for (const k of universeKeys) {
    // A canonical key is "mentioned" if it appears verbatim as a token (e.g. `toe_rear`) in
    // the expanded query. Multi-word keys never appear as a single token post-tokenize so
    // this only matches underscored / single-word canonical keys, which is what we want.
    if (queryTokenSet.has(k)) queriedCanonicalKeys.push(k);
  }

  let guaranteeAdds = 0;
  for (const key of queriedCanonicalKeys) {
    if (guaranteeAdds >= MAX_GUARANTEE_ADDS) break;
    // Already covered?
    let covered = false;
    for (const s of selected) {
      if (s.keyTokens.has(key)) {
        covered = true;
        break;
      }
    }
    if (covered) continue;
    // Find best unselected chunk that cites this key in its Key line.
    let bestIdx = -1;
    for (let i = 0; i < scored.length; i++) {
      if (selectedIdxSet.has(i)) continue;
      if (!scored[i].keyTokens.has(key)) continue;
      bestIdx = i;
      break; // scored[] is already sorted desc, first match is best.
    }
    if (bestIdx < 0) continue;
    // Evict lowest-scoring non-guaranteed chunk from tail to make room.
    if (selected.length >= limit) {
      // Find lowest-scoring selected chunk that does NOT itself cover any other
      // queriedCanonicalKey (so we don't evict our own previous guarantees).
      let evictAt = -1;
      for (let i = selected.length - 1; i >= 0; i--) {
        const s = selected[i];
        let coversSomeQueried = false;
        for (const qk of queriedCanonicalKeys) {
          if (s.keyTokens.has(qk)) {
            coversSomeQueried = true;
            break;
          }
        }
        if (!coversSomeQueried) {
          evictAt = i;
          break;
        }
      }
      if (evictAt < 0) continue; // All slots hold guaranteed chunks — skip.
      selected.splice(evictAt, 1);
    }
    selected.push(scored[bestIdx]);
    selectedIdxSet.add(bestIdx);
    guaranteeAdds++;
  }

  return selected.map((x) => x.snippet);
}
