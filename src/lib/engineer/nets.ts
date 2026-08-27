import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  renderNetEntry,
  validateNetEntry,
  type NetEntry,
} from "@/lib/engineer/netsSchema";

/**
 * Loader for the nets artifact (content/nets/ — empirical setup priors; authoring rules in
 * content/nets/README.md). Mirrors the KB loader's conventions: sorted filenames for a
 * byte-stable render, reviewed tier before a hedged drafts divider, per-process cache.
 *
 * Wired into the shipped payload since 2026-08-25 (founder call — ship first, iterate
 * through the harness; north star changelog). The "+nets" eval arm composes the same
 * blocks, so harness results on that arm describe the shipped Engineer.
 */

const NETS_DIR = path.join(process.cwd(), "content", "nets");
const NETS_DRAFTS_DIR = path.join(NETS_DIR, "drafts");

/**
 * Header on the nets block. States the confidence semantics — the rendering rule per
 * confidence level is the model's instruction, so it lives with the data it governs.
 */
export const ENGINEER_NETS_HEADER = `SETUP EFFECT PRIORS ("nets") — outcomes, in the driver's words. Probabilistic: "most likely", never "will".
Each entry says what one knob most likely does. A knob that changes how much or how fast the car rolls and moves its load has TWO lines — BEFORE THE CAR SETTLES and ONCE SETTLED — because it genuinely has two answers, and which one matters today depends on how long the corner lasts against how long this car takes to settle. The knowledge base above carries that rule; work out from it and from what the driver has told you which line applies, and say so. A knob with one EFFECT line acts through another mechanism and does not swing with the corner. A longer entry is not a better lever.
Nothing here says why, and nothing here says what makes an effect bigger, smaller or worth the opposite move — that all lives in the knowledge base, once. Never let a prior stand in for the mechanism it points at.
Each knob is written in one direction. The opposite move most likely does the opposite, unless a separate entry for that direction says otherwise — and a line that says "can" or "tends toward" means exactly that: it goes that way more often than not, and not always.
Confidence: "consensus" — state it plainly; "majority" — state it, naming the minority view when the driver's context matches it; "contested" — present both claims and the on-track discriminator, never pick silently. A "normal move" is what a typical-sized change looks like — calibration, never a recommendation of how far to go.

`;

const NETS_DRAFTS_DIVIDER = `──────── AI-DRAFTED PRIORS (below this line) ────────
Everything below is AI-drafted from published setup guides and NOT yet founder-reviewed. Hedge one step further than the stated confidence when using these.`;

export type LoadedNets = {
  /** Rendered block: header content only (no ENGINEER_NETS_HEADER prefix), byte-stable. */
  text: string;
  /** Reviewed entry files included, sorted. */
  files: string[];
  /** Draft entry files included, sorted. */
  draftFiles: string[];
  entries: NetEntry[];
};

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
  } catch {
    return [];
  }
}

async function readEntries(
  dir: string,
  files: string[],
  discipline: string | null
): Promise<{ entries: NetEntry[]; included: string[] }> {
  const entries: NetEntry[] = [];
  const included: string[] = [];
  for (const file of files) {
    let raw = "";
    try {
      raw = await fs.readFile(path.join(dir, file), "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch {
      console.warn(`[nets] ${file}: YAML parse failed — skipped`);
      continue;
    }
    const errs = validateNetEntry(parsed);
    if (errs.length > 0) {
      // A malformed entry must never take the Engineer down — skip it loudly.
      console.warn(`[nets] ${file}: invalid (${errs[0]}) — skipped`);
      continue;
    }
    const entry = parsed as NetEntry;
    if (discipline && entry.discipline !== discipline) continue;
    entries.push(entry);
    included.push(file);
  }
  return { entries, included };
}

const cache = new Map<string, Promise<LoadedNets>>();

/**
 * Load and render the nets for one discipline (null = all). Reviewed entries live under
 * `content/nets/<discipline>/`, drafts under `content/nets/drafts/` with the discipline
 * declared inside each file.
 */
export async function loadNets(params?: { discipline?: string | null }): Promise<LoadedNets> {
  const discipline = params?.discipline ?? null;
  const key = discipline ?? "*";
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const disciplineDirs: string[] = [];
    try {
      for (const d of await fs.readdir(NETS_DIR, { withFileTypes: true })) {
        if (d.isDirectory() && d.name !== "drafts" && (!discipline || d.name === discipline)) {
          disciplineDirs.push(d.name);
        }
      }
    } catch {
      /* no nets tree at all — loader returns empty */
    }

    const reviewed: NetEntry[] = [];
    const reviewedFiles: string[] = [];
    for (const d of disciplineDirs.sort()) {
      const dir = path.join(NETS_DIR, d);
      const { entries, included } = await readEntries(dir, await listYamlFiles(dir), null);
      reviewed.push(...entries);
      reviewedFiles.push(...included.map((f) => `${d}/${f}`));
    }

    const drafts = await readEntries(
      NETS_DRAFTS_DIR,
      await listYamlFiles(NETS_DRAFTS_DIR),
      discipline
    );

    const sections: string[] = reviewed.map(renderNetEntry);
    if (drafts.entries.length > 0) {
      sections.push(NETS_DRAFTS_DIVIDER, ...drafts.entries.map(renderNetEntry));
    }

    return {
      text: sections.join("\n\n"),
      files: reviewedFiles,
      draftFiles: drafts.included,
      entries: [...reviewed, ...drafts.entries],
    };
  })();

  cache.set(key, promise);
  return promise;
}
