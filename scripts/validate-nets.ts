/**
 * Nets validator — `npm run nets:check`.
 *
 * Checks every entry under content/nets/ (reviewed tiers + drafts/):
 *   - schema completeness (shared with the runtime loader: src/lib/engineer/netsSchema.ts)
 *   - one entry per knob, both directions inside; the shape matches `two_answers` on each side
 *   - no line carries a banned coinage (bite-hold.md's closed-vocabulary rule)
 *   - contested ⇒ both claims + discriminator present, per side (schema-level)
 *   - every `physics` file resolves in content/vehicle-dynamics/
 *   - the rendered entry stays under the size ceiling
 *   - no duplicate parameter per discipline
 *   - reports every side still marked `reviewed: false` (AI-drafted, owed a founder pass)
 *
 * Read-only. Exits 1 on any failure so it can gate a commit or a harness run.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { unreviewedSides, validateNetEntry, type NetEntry } from "@/lib/engineer/netsSchema";

const repoRoot = process.cwd();
const NETS_DIR = path.join(repoRoot, "content", "nets");
const KB_DIR = path.join(repoRoot, "content", "vehicle-dynamics");

function listYaml(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort();
  } catch {
    return [];
  }
}

function kbFileExists(link: string): boolean {
  return fs.existsSync(path.join(KB_DIR, link));
}

const files: Array<{ rel: string; abs: string }> = [];
try {
  for (const d of fs.readdirSync(NETS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of listYaml(path.join(NETS_DIR, d.name))) {
      files.push({ rel: `${d.name}/${f}`, abs: path.join(NETS_DIR, d.name, f) });
    }
  }
} catch {
  console.error(`No nets tree at ${NETS_DIR}`);
  process.exit(1);
}

let failures = 0;
const seen = new Map<string, string>(); // `${discipline}:${parameter}` -> file
const unreviewed: string[] = [];
let sidesWritten = 0;

for (const { rel, abs } of files) {
  const problems: string[] = [];
  let entry: NetEntry | null = null;
  try {
    const parsed = parseYaml(fs.readFileSync(abs, "utf8"));
    const errs = validateNetEntry(parsed);
    problems.push(...errs);
    if (errs.length === 0) entry = parsed as NetEntry;
  } catch (e) {
    problems.push(`YAML parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (entry) {
    for (const link of entry.physics) {
      if (!kbFileExists(link)) {
        problems.push(`physics "${link}" does not resolve in content/vehicle-dynamics/`);
      }
    }
    const dupKey = `${entry.discipline}:${entry.parameter}`;
    const prev = seen.get(dupKey);
    if (prev) problems.push(`duplicate parameter for ${entry.discipline} — already defined in ${prev}`);
    else seen.set(dupKey, rel);
    if (entry.more) sidesWritten++;
    if (entry.less) sidesWritten++;
    unreviewed.push(...unreviewedSides(entry));
  }

  if (problems.length > 0) {
    failures++;
    console.error(`FAIL  ${rel}`);
    for (const p of problems) console.error(`      - ${p}`);
  } else {
    console.log(`ok    ${rel}`);
  }
}

if (unreviewed.length > 0) {
  console.log(`\n${unreviewed.length} of ${sidesWritten} sides AI-drafted, not yet founder-reviewed:`);
  for (const s of unreviewed) console.log(`  - ${s}`);
}
console.log(`\n${files.length - failures}/${files.length} entries valid`);
process.exit(failures > 0 ? 1 : 0);
