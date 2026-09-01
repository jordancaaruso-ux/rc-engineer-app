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
 * Header on the nets block. Since 2026-09-01 (founder call) the per-side confidence tag is not
 * rendered and the header says every entry carries the same weight — the tags had become a lever
 * ranking (consensus knobs led every answer; the geometry, all majority, never did).
 */
export const ENGINEER_NETS_HEADER = `SETUP EFFECT PRIORS ("nets") — outcomes, in the driver's words. Probabilistic: "most likely", never "will".
Each entry is one knob, with what each direction most likely does — both directions side by side. A knob that does one thing on the way into the corner and another through the middle carries TWO lines per direction — ON THE WAY IN and THROUGH THE MIDDLE — because it genuinely has two answers, and which one matters today depends on how long the corner lasts against how long this car takes to settle. The knowledge base above carries that rule; work out from it and from what the driver has told you which line applies, and say so. Speak of places on the corner — going in, the middle, coming out — never of whether the car has "settled": that is the knowledge base's word, not the driver's. A knob with one EFFECT line per direction does the same thing throughout the corner, whatever its clock says. A longer entry is not a better lever.
Nothing here says why, and nothing here says what makes an effect bigger, smaller or worth the opposite move — that all lives in the knowledge base, once. Never treat a prior as evidence about the mechanism it points at.
Where a knob shows only one direction, the opposite move most likely does the opposite. A line that says "can" or "tends toward" means exactly that: it goes that way more often than not, and not always.
Every entry carries the same weight: no prior outranks another — choose by fit to the driver's problem, never by how an entry is worded. Where an entry carries CONTESTED claims, present both and the on-track discriminator, never pick silently. A "normal move" is what a typical-sized change looks like; size the move to the problem — a chronic one that is everywhere takes a big move, a small complaint a small one.

`;

const NETS_DRAFTS_DIVIDER = `──────── AI-DRAFTED PRIORS (below this line) ────────
Everything below is AI-drafted from published setup guides and NOT yet founder-reviewed. Hedge these harder than the entries above.`;

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
