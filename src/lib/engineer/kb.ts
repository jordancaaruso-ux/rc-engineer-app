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

/**
 * The divider above the drafts tier. Rewritten 2026-09-02 (founder call, after the whole-system
 * audit): the old text told the model to cite drafts as "draft `file.md`" and called them "general
 * vehicle-dynamics theory" — on the same wire as a header that forbids naming files and a prompt
 * that forbids general racing knowledge. Drafts still ride along; they are hedged, never named.
 */
const FULL_KB_DRAFTS_DIVIDER = `──────── UNVERIFIED (below this line) ────────
Everything below is not yet founder-verified. Reason from it only where nothing above covers the question, say the ground is unverified when you do, and where it disagrees with anything above, the text above wins. The rule against naming files holds here too.`;

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

      // The grip curve is the one picture every other file hangs on (founder, 2026-08-28: "a
      // first-class thing the engineer reads"), so it goes first — ahead of the alphabetical
      // parameter files — and nowhere else describes the curve.
      // Response (the angle the car gives the tyre) is the grip curve's pair — "two things in
      // series" — so it rides directly behind it (founder, 2026-08-29).
      const PINNED = ["concepts/grip-curve.md", "concepts/steering-response.md"];
      const pinnedIdx = PINNED.map((f) => concepts.included.indexOf(f)).filter((i) => i >= 0);
      const firstPart = pinnedIdx.map((i) => concepts.parts[i]);
      const restConcepts = concepts.parts.filter((_, i) => !pinnedIdx.includes(i));
      const sections = [...firstPart, ...approved.parts, ...restConcepts];
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
