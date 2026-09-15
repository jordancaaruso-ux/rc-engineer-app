import fs from "node:fs/promises";
import path from "node:path";
import type { NetEntry } from "@/lib/engineer/netsSchema";

/**
 * Lever families, derived from the knowledge base rather than listed by hand.
 *
 * A concept page (content/vehicle-dynamics/concepts/<slug>.md) carries a `**Moved by:**` line
 * naming the knobs that move it. Every `[[link]]` on that line that resolves to a top-level KB
 * knob page claims that page's nets for the concept. A knob claimed by no concept stands alone;
 * a knob claimed by two concepts goes to the first by slug, so the render is byte-stable and no
 * one has to arbitrate. Founder call 2026-09-08: a rear spring and a rear bar were reaching the
 * model as two unrelated levers and coming back as two separate alternatives, when the KB already
 * says they are one change (roll-stiffness.md names both and says what separates them). This
 * makes that structure visible on the wire without a list anyone maintains: add a link to a
 * Moved-by line and the family grows; remove it and the knob stands alone again.
 */

const KB_DIR = path.join(process.cwd(), "content", "vehicle-dynamics");
const CONCEPTS_DIR = path.join(KB_DIR, "concepts");

export type NetFamily = {
  /** Concept slug — the file stem under concepts/. */
  concept: string;
  /** The concept page's H2 minus a trailing parenthetical — the heading the model reads. */
  title: string;
  /** Top-level KB knob pages the Moved-by line links, in link order, de-duplicated. */
  knobPages: string[];
};

function titleFromH2(md: string, slug: string): string {
  const m = md.match(/^##\s+(.+?)\s*$/m);
  return (m?.[1] ?? slug.replace(/-/g, " ")).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** The `**Moved by:**` line plus its continuation lines, up to a blank line or the next field. */
function movedByText(md: string): string | null {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\*\*Moved by:\*\*/.test(l));
  if (start < 0) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "" || /^\*\*[A-Z]/.test(l) || /^#/.test(l)) break;
    out.push(l);
  }
  return out.join(" ");
}

export async function loadNetFamilies(): Promise<NetFamily[]> {
  let conceptFiles: string[];
  let knobFiles: string[];
  try {
    conceptFiles = (await fs.readdir(CONCEPTS_DIR)).filter((f) => f.endsWith(".md")).sort();
    knobFiles = (await fs.readdir(KB_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const knobSlugs = new Set(knobFiles.map((f) => f.replace(/\.md$/, "")));
  const families: NetFamily[] = [];
  for (const file of conceptFiles) {
    const slug = file.replace(/\.md$/, "");
    const md = await fs.readFile(path.join(CONCEPTS_DIR, file), "utf8");
    const moved = movedByText(md);
    if (!moved) continue;
    const knobPages: string[] = [];
    for (const m of moved.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) {
      const s = m[1];
      if (knobSlugs.has(s) && !knobPages.includes(s)) knobPages.push(s);
    }
    if (knobPages.length > 0) families.push({ concept: slug, title: titleFromH2(md, slug), knobPages });
  }
  return families;
}

/** The family that claims a net through its `physics[0]` page, or null when it stands alone. */
export function familyOf(entry: NetEntry, families: NetFamily[]): NetFamily | null {
  const page = (entry.physics[0] ?? "").replace(/\.md$/, "");
  return families.find((f) => f.knobPages.includes(page)) ?? null;
}

export type NetUnit =
  | { kind: "group"; family: NetFamily; entries: NetEntry[] }
  | { kind: "single"; entry: NetEntry };

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Partition entries into groups (a family with two or more knobs) and singles, in one order keyed
 * by heading — a group's title or a single's label, lower-cased — so the render is byte-stable and
 * nothing structural puts grouped levers ahead of the rest.
 */
export function groupNets(entries: NetEntry[], families: NetFamily[]): NetUnit[] {
  const byConcept = new Map<string, { family: NetFamily; entries: NetEntry[] }>();
  const singles: NetEntry[] = [];
  for (const e of entries) {
    const fam = familyOf(e, families);
    if (!fam) {
      singles.push(e);
      continue;
    }
    const g = byConcept.get(fam.concept) ?? { family: fam, entries: [] };
    g.entries.push(e);
    byConcept.set(fam.concept, g);
  }
  const units: NetUnit[] = [];
  for (const g of byConcept.values()) {
    if (g.entries.length >= 2) {
      g.entries.sort((a, b) => cmp(a.label.toLowerCase(), b.label.toLowerCase()));
      units.push({ kind: "group", family: g.family, entries: g.entries });
    } else {
      singles.push(...g.entries);
    }
  }
  for (const e of singles) units.push({ kind: "single", entry: e });
  const key = (u: NetUnit) => (u.kind === "group" ? u.family.title : u.entry.label).toLowerCase();
  units.sort((a, b) => cmp(key(a), key(b)));
  return units;
}

/**
 * A whole-car move: the same change at both ends together (content/nets/<discipline>/_whole-car.yaml).
 * Founder ruling 2026-09-09: rendered as lines on the family's GROUP heading, both directions, each
 * naming its too-far edge, no day words. A pair belongs to a group when every knob it names is in it.
 */
export type WholeCarPair = {
  id: string;
  label: string;
  knobs: string[];
  step: string | null;
  reviewed: boolean;
  more: string;
  less: string;
};

export function wholeCarPairsFor(unit: Extract<NetUnit, { kind: "group" }>, pairs: WholeCarPair[]): WholeCarPair[] {
  const params = new Set(unit.entries.map((e) => e.parameter));
  return pairs.filter((p) => p.knobs.length >= 2 && p.knobs.every((k) => params.has(k)));
}

/** The BOTH ENDS TOGETHER lines under a GROUP heading, one pair per line. */
export function renderWholeCarLines(pairs: WholeCarPair[]): string[] {
  return pairs.map(
    (p) =>
      `  BOTH ENDS TOGETHER — ${p.label}${p.step ? ` | a normal move: ${p.step}` : ""}\n    ${p.more}\n    ${p.less}`
  );
}

/** The GROUP line the model reads above a family's entries. */
export function renderGroupHeading(unit: Extract<NetUnit, { kind: "group" }>): string {
  const labels = unit.entries.map((e) => e.label).join(" · ");
  return `GROUP: ${unit.family.title.toUpperCase()} (${unit.entries.length} knobs, one change): ${labels}`;
}
