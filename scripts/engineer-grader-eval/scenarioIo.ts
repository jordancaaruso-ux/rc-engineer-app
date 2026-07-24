/** Load/save committed scenario JSON files (one scenario per file). */
import fs from "node:fs/promises";
import path from "node:path";
import type { Scenario } from "./types";

function isScenario(v: unknown): v is Scenario {
  const s = v as Scenario | null;
  return !!s && typeof s.id === "string" && !!s.world && Array.isArray(s.world.runs) && typeof s.question === "string";
}

export async function loadScenarios(dir: string): Promise<Scenario[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Scenario[] = [];
  for (const f of entries.filter((e) => e.endsWith(".json")).sort()) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as unknown;
      if (isScenario(parsed)) out.push(parsed);
    } catch {
      // skip unparseable
    }
  }
  return out;
}

/** Load from several dirs (e.g. seed/ then scenarios/), first id wins on collision. */
export async function loadScenariosFromDirs(dirs: string[]): Promise<Scenario[]> {
  const all: Scenario[] = [];
  const seen = new Set<string>();
  for (const d of dirs) {
    for (const s of await loadScenarios(d)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      all.push(s);
    }
  }
  return all;
}

export async function writeScenario(dir: string, scn: Scenario): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, `${scn.id}.json`);
  await fs.writeFile(p, JSON.stringify(scn, null, 2), "utf8");
  return p;
}
