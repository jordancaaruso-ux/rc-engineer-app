/**
 * Engineer KB coverage / gap report (read-only).
 *
 * Builds the parameter x outcome coverage matrix described in the Engineer AI
 * strategy plan and prints what is filled vs missing. It reads source files
 * directly (no app imports, so `server-only` modules are never loaded):
 *
 *   - content/vehicle-dynamics/*.md          -> prose KB coverage per canonical key
 *   - parameterEffects/types.ts              -> the closed Outcome union (matrix columns)
 *   - parameterEffects/intentFromMessage.ts  -> which outcomes are reachable (orphan check)
 *   - parameterEffects/catalog.ts            -> structured (key x outcome) entries (matrix cells)
 *   - setupComparison/tuningComparisonKeys.ts-> sheet key universe (orphan-key check)
 *
 * Usage:
 *   node scripts/kb-coverage-report.cjs            # human-readable report
 *   node scripts/kb-coverage-report.cjs --json     # machine-readable JSON
 *
 * This script writes nothing. It is the never-stale worklist for KB fill.
 */
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const KB_DIR = path.join(repoRoot, "content", "vehicle-dynamics");
const PARAM_EFFECTS_DIR = path.join(repoRoot, "src", "lib", "engineerPhase5", "parameterEffects");
const TYPES_FILE = path.join(PARAM_EFFECTS_DIR, "types.ts");
const INTENT_FILE = path.join(PARAM_EFFECTS_DIR, "intentFromMessage.ts");
const CATALOG_FILE = path.join(PARAM_EFFECTS_DIR, "catalog.ts");
const TUNING_KEYS_FILE = path.join(repoRoot, "src", "lib", "setupComparison", "tuningComparisonKeys.ts");

const wantJson = process.argv.includes("--json");

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** Strip `//` line comments and `/* *\/` block comments so brace matching is safe. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre);
}

function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ----------------------------- prose KB --------------------------------- */

/**
 * key -> [{ file, section }] for every canonical key declared in a `**Keys:**`
 * line, plus file -> [sections] for reference.
 */
function loadKbCoverage() {
  const keyToSections = new Map();
  const fileSections = new Map();
  let files = [];
  try {
    files = fs.readdirSync(KB_DIR).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
  } catch {
    return { keyToSections, fileSections, files: [] };
  }
  for (const file of files.sort()) {
    const raw = readFileSafe(path.join(KB_DIR, file));
    const sections = [];
    const parts = /\n##\s/.test(raw) ? raw.split(/\n(?=##\s)/) : [raw];
    for (const part of parts) {
      const lines = part.trim().split("\n");
      const titleLine = (lines[0] || "").replace(/^#+\s*/, "").trim() || file;
      const sectionSlug = slugify(titleLine);
      sections.push(titleLine);
      for (const line of lines) {
        if (!/\*\*Keys?(?:\s*\([^)]*\))?:\*\*/.test(line)) continue;
        const backticked = line.match(/`([^`]+)`/g) || [];
        for (const raw2 of backticked) {
          const key = raw2.slice(1, -1).trim().toLowerCase();
          if (key.length < 2) continue;
          // Skip cross-references to other KB files cited on the same Keys line.
          if (key.endsWith(".md")) continue;
          if (!keyToSections.has(key)) keyToSections.set(key, []);
          keyToSections.get(key).push({ file, section: titleLine, sectionSlug });
        }
      }
    }
    fileSections.set(file, sections);
  }
  return { keyToSections, fileSections, files };
}

/* ----------------------------- outcomes --------------------------------- */

function loadOutcomes() {
  const src = readFileSafe(TYPES_FILE);
  const m = src.match(/export type Outcome\s*=([\s\S]*?);/);
  if (!m) return [];
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

function loadReachableOutcomes() {
  const src = readFileSafe(INTENT_FILE);
  const out = new Set();
  for (const m of src.matchAll(/outcome:\s*"([a-z_]+)"/g)) out.add(m[1]);
  return out;
}

/* ----------------------------- catalog ---------------------------------- */

/** Split the top-level objects of an array body using brace matching. */
function splitTopLevelObjects(arrayBody) {
  const objs = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < arrayBody.length; i++) {
    const ch = arrayBody[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        objs.push(arrayBody.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objs;
}

function loadCatalog(outcomes) {
  const srcRaw = readFileSafe(CATALOG_FILE);
  const src = stripComments(srcRaw);
  const open = src.indexOf("PARAMETER_EFFECT_CATALOG");
  if (open < 0) return [];
  const eq = src.indexOf("[", open);
  if (eq < 0) return [];
  // Brace/bracket match from the opening [ to its closing ].
  let depth = 0;
  let end = -1;
  for (let i = eq; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  const body = src.slice(eq + 1, end);
  const entries = [];
  for (const objSrc of splitTopLevelObjects(body)) {
    const parameterKey = (objSrc.match(/parameterKey:\s*"([^"]+)"/) || [])[1];
    if (!parameterKey) continue;
    const kbSource = (objSrc.match(/kbSource:\s*"([^"]+)"/) || [])[1] || null;
    const kbSection = (objSrc.match(/kbSection:\s*"([^"]+)"/) || [])[1] || null;
    const effects = {};
    for (const outcome of outcomes) {
      const re = new RegExp(`${outcome}:\\s*{([^}]*)}`);
      const em = objSrc.match(re);
      if (!em) continue;
      const inner = em[1];
      const dir = (inner.match(/dir:\s*"([+-])"/) || [])[1] || "?";
      const hedge = /hedge:\s*true/.test(inner);
      const strength = (inner.match(/strength:\s*"([a-z]+)"/) || [])[1] || "?";
      effects[outcome] = { dir, hedge, strength };
    }
    entries.push({ parameterKey, kbSource, kbSection, effects });
  }
  return entries;
}

/* --------------------------- sheet key universe ------------------------- */

const PREFIX_SUFFIXES = {
  camber_: ["front", "rear"],
  caster_: ["front", "rear"],
  toe_: ["front", "rear"],
  ride_height_: ["front", "rear"],
  droop_: ["front", "rear"],
  downstop_: ["front", "rear"],
  upstop_: ["front", "rear"],
  arb_: ["front", "rear"],
  diff_height_: ["front", "center", "rear"],
  damper_oil_: ["front", "rear"],
  damper_percent_: ["front", "rear"],
  pss_percent_setup_: ["front", "rear"],
  damping_: ["front", "rear"],
  spring_: ["front", "rear"],
};

function loadSheetKeys() {
  const src = readFileSafe(TUNING_KEYS_FILE);
  const keys = new Set();
  const setMatch = src.match(/EXACT_TUNING_KEYS\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/);
  if (setMatch) {
    for (const m of setMatch[1].matchAll(/"([^"]+)"/g)) keys.add(m[1]);
  }
  const prefMatch = src.match(/TUNING_KEY_PREFIXES[^=]*=\s*\[([\s\S]*?)\]/);
  const prefixes = [];
  if (prefMatch) {
    for (const m of prefMatch[1].matchAll(/"([^"]+)"/g)) prefixes.push(m[1]);
  }
  // Expand prefixes heuristically into expected concrete keys.
  for (const p of prefixes) {
    const suffixes = PREFIX_SUFFIXES[p];
    if (suffixes) {
      for (const s of suffixes) keys.add(`${p}${s}`);
    } else {
      keys.add(`${p}*`);
    }
  }
  return { keys, prefixes };
}

/* ------------------------------ build report ---------------------------- */

function build() {
  const { keyToSections, fileSections, files } = loadKbCoverage();
  const outcomes = loadOutcomes();
  const reachable = loadReachableOutcomes();
  const catalog = loadCatalog(outcomes);
  const { keys: sheetKeys, prefixes } = loadSheetKeys();

  const kbKeys = new Set(keyToSections.keys());
  const catalogKeys = new Set(catalog.map((e) => e.parameterKey));

  // Matrix rows = union of KB-covered keys and catalogued keys.
  const rows = [...new Set([...kbKeys, ...catalogKeys])].sort();

  const catalogByKey = new Map(catalog.map((e) => [e.parameterKey, e]));

  const matrix = rows.map((key) => {
    const entry = catalogByKey.get(key);
    const cells = {};
    for (const outcome of outcomes) {
      cells[outcome] = entry && entry.effects[outcome] ? entry.effects[outcome] : null;
    }
    return {
      key,
      hasKbProse: kbKeys.has(key),
      hasCatalogEntry: Boolean(entry),
      kbSections: keyToSections.get(key) || [],
      cells,
    };
  });

  const orphanOutcomes = outcomes.filter((o) => !reachable.has(o));
  const kbKeysNoCatalog = [...kbKeys].filter((k) => !catalogKeys.has(k)).sort();
  const sheetKeysNoKb = [...sheetKeys].filter((k) => !kbKeys.has(k) && !k.endsWith("*")).sort();

  const totalCells = rows.length * outcomes.length;
  let filledCells = 0;
  for (const r of matrix) for (const o of outcomes) if (r.cells[o]) filledCells++;

  return {
    outcomes,
    reachableOutcomes: [...reachable].sort(),
    orphanOutcomes,
    kbFiles: files,
    fileSections: Object.fromEntries(fileSections),
    rows,
    matrix,
    catalogEntryCount: catalog.length,
    kbKeyCount: kbKeys.size,
    kbKeysNoCatalog,
    sheetKeyCount: sheetKeys.size,
    sheetKeysNoKb,
    sheetPrefixes: prefixes,
    coverage: { totalCells, filledCells, pct: totalCells ? Math.round((filledCells / totalCells) * 100) : 0 },
  };
}

/* ------------------------------ render ---------------------------------- */

function cellGlyph(cell) {
  if (!cell) return " . ";
  const dir = cell.dir === "+" ? "+" : cell.dir === "-" ? "-" : "?";
  const strength = cell.strength === "strong" ? "S" : cell.strength === "moderate" ? "M" : cell.strength === "weak" ? "w" : "?";
  const hedge = cell.hedge ? "~" : " ";
  return `${dir}${strength}${hedge}`;
}

function render(report) {
  const { outcomes, matrix } = report;
  const lines = [];
  lines.push("=".repeat(78));
  lines.push("ENGINEER KB COVERAGE / GAP REPORT");
  lines.push("=".repeat(78));
  lines.push("");
  lines.push(
    `Catalog entries: ${report.catalogEntryCount}   ` +
      `KB-covered keys: ${report.kbKeyCount}   ` +
      `Matrix cells filled: ${report.coverage.filledCells}/${report.coverage.totalCells} (${report.coverage.pct}%)`
  );
  lines.push("");
  lines.push(`Outcomes (matrix columns): ${outcomes.join(", ")}`);
  lines.push("");

  // Matrix. Short outcome headers.
  const shortCols = outcomes.map((o) =>
    o
      .split("_")
      .map((w) => w.slice(0, 3))
      .join("")
      .slice(0, 6)
      .padEnd(6)
  );
  const keyColW = Math.max(28, ...matrix.map((r) => r.key.length + 2));
  lines.push("LEGEND: cell = <dir><strength><hedge>   dir +/-   strength S/M/w   hedge ~   '.' = empty   'KB' col = has prose");
  lines.push("");
  lines.push("KEY".padEnd(keyColW) + "KB  " + shortCols.join(" "));
  lines.push("-".repeat(keyColW + 4 + shortCols.join(" ").length));
  for (const r of matrix) {
    const kb = r.hasKbProse ? "yes " : "--  ";
    const cells = outcomes.map((o) => cellGlyph(r.cells[o]).padEnd(6)).join(" ");
    lines.push(r.key.padEnd(keyColW) + kb + cells);
  }
  lines.push("");

  // Gap sections.
  lines.push("-".repeat(78));
  lines.push("ORPHAN OUTCOMES (in Outcome union but unreachable — no intent phrases):");
  lines.push(report.orphanOutcomes.length ? "  " + report.orphanOutcomes.join(", ") : "  (none)");
  lines.push("");
  lines.push("KB-COVERED KEYS WITH NO CATALOG ENTRY (prime catalog-fill candidates):");
  lines.push(report.kbKeysNoCatalog.length ? report.kbKeysNoCatalog.map((k) => "  " + k).join("\n") : "  (none)");
  lines.push("");
  lines.push("SHEET KEYS WITH NO KB PROSE AT ALL (need a KB section before cataloguing):");
  lines.push(report.sheetKeysNoKb.length ? report.sheetKeysNoKb.map((k) => "  " + k).join("\n") : "  (none)");
  lines.push("");
  lines.push("-".repeat(78));
  lines.push("KB FILES INDEXED:");
  for (const f of report.kbFiles) {
    const secs = report.fileSections[f] || [];
    lines.push(`  ${f}  (${secs.length} sections)`);
  }
  lines.push("=".repeat(78));
  return lines.join("\n");
}

const report = build();
if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(render(report));
}
