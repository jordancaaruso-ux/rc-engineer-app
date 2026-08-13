import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Loader for the vehicle-dynamics knowledge base — the one artifact that survived the
 * 2026-08-13 ground-up rebuild. Extracted verbatim from the deleted
 * engineerPhase5/vehicleDynamicsKb.ts; the bag-of-words retriever that lived alongside it
 * was dead machinery and did not come across.
 */

const KB_DIR = path.join(process.cwd(), "content", "vehicle-dynamics");
/**
 * AI-drafted baseline tier: agent-written reference theory, clearly marked everywhere it
 * surfaces, never founder-tier authority. Promotion = founder edits + moves the file up
 * into KB_DIR.
 */
const KB_DRAFTS_DIR = path.join(KB_DIR, "drafts");
/**
 * Founder-approved concept layer: shared physics / feel nodes stated once, linked from
 * parameter files via `[[slug]]`. Same authority tier as the top-level files — NOT drafts.
 * Lives in a subfolder, so the loader must read it explicitly (readdir here is non-recursive).
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
 * Whole-corpus load for full-KB-in-context advice turns: every `.md` under
 * `content/vehicle-dynamics/` except README, sorted by filename so the concatenation is
 * byte-stable across requests. Cached per process.
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
