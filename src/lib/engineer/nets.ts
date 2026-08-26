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
export const ENGINEER_NETS_HEADER = `SETUP EFFECT PRIORS ("nets") — an INDEX, not a rulebook.
Every knob on the car is a slider: too far one way is bad, too far the other way is bad, and the good spot MOVES with grip, corner speed and how rough the surface is. Each entry below says only which slider that knob moves, which way, at which end — plus one line of what the driver notices. Entries are short and all the same size on purpose: a longer entry is not a better lever.
Every "it depends" lives in the slider's own file in the knowledge base above, written once. So do not expect conditions here, and do not treat a SLIDES line as an outcome on its own — read the slider, work out where this car already sits on it and which way today's conditions have moved the good spot, and answer from that. A knob that moves a slider toward the bite end is an entry-phase answer without this file saying so.
Confidence: "consensus" — state it plainly; "majority" — state it, naming the minority view when the driver's context matches it; "contested" — present both claims and the on-track discriminator, never pick silently. "knock-on" means the effect is a consequence of moving the other end, not a direct action. A "step" is what a normal-sized move looks like — calibration, never a recommendation of how far to go.
Never present a prior as a guarantee, and never let one stand in for the physics it points at.

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
