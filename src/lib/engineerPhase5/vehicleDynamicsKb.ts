import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

const KB_DIR = path.join(process.cwd(), "content", "vehicle-dynamics");
/**
 * AI-drafted baseline tier (AGENTS.md, 2026-07-07): agent-written reference theory,
 * clearly marked everywhere it surfaces, never founder-tier authority. Promotion =
 * founder edits + moves the file up into KB_DIR.
 */
const KB_DRAFTS_DIR = path.join(KB_DIR, "drafts");
/**
 * Founder-approved concept layer (KB restructure, 2026-07): shared physics / feel nodes stated once,
 * linked from parameter files via `[[slug]]`. Same authority tier as the top-level files — NOT drafts.
 * Lives in a subfolder, so both loaders must read it explicitly (readdir here is non-recursive).
 */
const KB_CONCEPTS_DIR = path.join(KB_DIR, "concepts");

async function listKbMarkdownFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir))
      .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
      .sort();
  } catch {
    return [];
  }
}

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

/** Cap on how many linked concept chunks we co-surface alongside a matched parameter chunk. */
const MAX_CONCEPT_ADDS = 6;

/** Pull every `[[concept-slug]]` link out of a chunk body (lowercased). */
function extractLinkSlugs(body: string): string[] {
  const out: string[] = [];
  const re = /\[\[([a-z0-9-]+)\]\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1].toLowerCase());
  return out;
}

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
  /** `[[concept-slug]]` links found in this chunk — used to co-surface linked concepts. */
  linkSlugs: string[];
  snippet: VehicleDynamicsKbSnippet;
};

export type FullVehicleDynamicsKb = {
  /** All KB files concatenated with `=== vehicle-dynamics/<file> ===` separators. */
  markdown: string;
  /** Founder-approved filenames included, sorted (stable order keeps the prompt-cache prefix stable). */
  files: string[];
  /** AI-drafted baseline filenames included (drafts/ tier), sorted. */
  draftFiles: string[];
  totalChars: number;
};

const FULL_KB_DRAFTS_DIVIDER = `──────── AI-DRAFTED BASELINE FILES (below this line) ────────
Everything below is AI-researched baseline theory, NOT founder-approved ground truth. Cite as "draft \`file.md\`" with hedged wording ("general vehicle-dynamics theory — not yet verified for this KB"); when a draft and an approved file above disagree, the approved file wins.`;

let fullKbCache: FullVehicleDynamicsKb | null = null;
let fullKbLoadPromise: Promise<FullVehicleDynamicsKb> | null = null;

/**
 * Whole-corpus load for full-KB-in-context advice turns (ENGINEER_NORTH_STAR.md, KB
 * architecture): every `.md` under `content/vehicle-dynamics/` except README, sorted by
 * filename so the concatenation is byte-stable across requests. Cached per process like
 * the retrieval index.
 */
export async function loadFullVehicleDynamicsKb(): Promise<FullVehicleDynamicsKb> {
  if (fullKbCache) return fullKbCache;
  if (!fullKbLoadPromise) {
    fullKbLoadPromise = (async () => {
      const approvedFiles = await listKbMarkdownFiles(KB_DIR);
      const conceptFiles = await listKbMarkdownFiles(KB_CONCEPTS_DIR);
      const draftFiles = await listKbMarkdownFiles(KB_DRAFTS_DIR);

      const readParts = async (
        dir: string,
        files: string[],
        pathPrefix: string,
        suffix: string,
        includedPrefix: string
      ) => {
        const parts: string[] = [];
        const included: string[] = [];
        for (const file of files) {
          let raw = "";
          try {
            raw = await fs.readFile(path.join(dir, file), "utf8");
          } catch {
            continue;
          }
          const body = raw.trim();
          if (!body) continue;
          parts.push(`=== ${pathPrefix}${file}${suffix} ===\n\n${body}`);
          included.push(`${includedPrefix}${file}`);
        }
        return { parts, included };
      };

      const approved = await readParts(KB_DIR, approvedFiles, "vehicle-dynamics/", "", "");
      // Concepts are founder-tier: ship them in the approved section (before the drafts divider).
      const concepts = await readParts(
        KB_CONCEPTS_DIR,
        conceptFiles,
        "vehicle-dynamics/concepts/",
        "",
        "concepts/"
      );
      const drafts = await readParts(
        KB_DRAFTS_DIR,
        draftFiles,
        "vehicle-dynamics/drafts/",
        " (AI DRAFT — unverified)",
        ""
      );

      const sections = [...approved.parts, ...concepts.parts];
      if (drafts.parts.length > 0) {
        sections.push(FULL_KB_DRAFTS_DIVIDER, ...drafts.parts);
      }
      const markdown = sections.join("\n\n");
      const out = {
        markdown,
        files: [...approved.included, ...concepts.included].sort(),
        draftFiles: drafts.included,
        totalChars: markdown.length,
      };
      fullKbCache = out;
      return out;
    })();
  }
  return fullKbLoadPromise;
}

type KbIndexEntry = {
  title: string;
  body: string;
  file: string;
  keyTokens: Set<string>;
};

let kbIndexCache: KbIndexEntry[] | null = null;
let kbIndexLoadPromise: Promise<KbIndexEntry[]> | null = null;

async function loadKbIndex(): Promise<KbIndexEntry[]> {
  if (kbIndexCache) return kbIndexCache;
  if (!kbIndexLoadPromise) {
    kbIndexLoadPromise = (async () => {
      const entries: KbIndexEntry[] = [];
      const indexDir = async (dir: string, filePrefix: string, titlePrefix: string) => {
        for (const file of await listKbMarkdownFiles(dir)) {
          let raw = "";
          try {
            raw = await fs.readFile(path.join(dir, file), "utf8");
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
            entries.push({
              title: `${titlePrefix}${title}`,
              body,
              file: `${filePrefix}${file}`,
              keyTokens: extractKeyTokens(body),
            });
          }
        }
      };
      await indexDir(KB_DIR, "", "");
      // Concept layer (founder-tier) — retrievable so a bare keyword query can hit a concept,
      // and so co-surfacing can pull a matched parameter's linked concepts.
      await indexDir(KB_CONCEPTS_DIR, "concepts/", "");
      // AI-drafted tier: retrievable, but marked so consumers and the model can tell
      // the provenance apart from founder-approved prose (AGENTS.md drafts rules).
      await indexDir(KB_DRAFTS_DIR, "drafts/", "[draft] ");
      kbIndexCache = entries;
      return entries;
    })();
  }
  return kbIndexLoadPromise;
}

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

  const index = await loadKbIndex();
  const scored: ScoredChunk[] = [];

  for (const { title, body, file, keyTokens } of index) {
    const keyLine = extractKeyLine(body);
    const sc = scoreChunk(title, keyLine, body, tokens);
    if (sc <= 0) continue;
    const text = `${title}\n${body}`;
    const excerpt = text.length > 900 ? `${text.slice(0, 897)}…` : text;
    scored.push({
      score: sc,
      keyTokens,
      linkSlugs: extractLinkSlugs(body),
      snippet: {
        sourcePath: `vehicle-dynamics/${file}`,
        title: title.length > 80 ? `${title.slice(0, 77)}…` : title,
        excerpt,
      },
    });
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

  // Co-surface linked concepts (light-tier robustness): when a selected chunk references a concept
  // via [[slug]], pull that concept in as supporting context — plus one hop of concept→concept links
  // — even if the concept itself didn't match the query. Appended after the ranked matches, capped.
  const conceptBySlug = new Map<string, KbIndexEntry>();
  for (const e of index) {
    if (!e.file.startsWith("concepts/")) continue;
    conceptBySlug.set(e.file.slice("concepts/".length).replace(/\.md$/i, ""), e);
  }
  const alreadyPaths = new Set(selected.map((s) => s.snippet.sourcePath));
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const s of selected) for (const slug of s.linkSlugs) queue.push(slug);
  const conceptAdds: VehicleDynamicsKbSnippet[] = [];
  while (queue.length > 0 && conceptAdds.length < MAX_CONCEPT_ADDS) {
    const slug = queue.shift()!;
    if (visited.has(slug)) continue;
    visited.add(slug);
    const entry = conceptBySlug.get(slug);
    if (!entry) continue;
    const sourcePath = `vehicle-dynamics/${entry.file}`;
    if (alreadyPaths.has(sourcePath)) continue;
    alreadyPaths.add(sourcePath);
    const text = `${entry.title}\n${entry.body}`;
    conceptAdds.push({
      sourcePath,
      title: entry.title.length > 80 ? `${entry.title.slice(0, 77)}…` : entry.title,
      excerpt: text.length > 900 ? `${text.slice(0, 897)}…` : text,
    });
    for (const next of extractLinkSlugs(entry.body)) queue.push(next);
  }

  return [...selected.map((x) => x.snippet), ...conceptAdds];
}
