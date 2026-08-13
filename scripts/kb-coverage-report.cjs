/**
 * Engineer KB coverage / gap report (read-only).
 *
 * Reads source files directly (no app imports, so `server-only` modules are never loaded):
 *
 *   - content/vehicle-dynamics/*.md          -> prose KB coverage per canonical key
 *   - setupComparison/tuningComparisonKeys.ts-> sheet key universe (orphan-key check)
 *
 * The structured parameter-effects matrix this once also read died with engineerPhase5
 * in the 2026-08-13 rebuild; the prose half below is the never-stale worklist for KB fill.
 *
 * Usage:
 *   node scripts/kb-coverage-report.cjs            # human-readable report
 *   node scripts/kb-coverage-report.cjs --json     # machine-readable JSON
 *
 * This script writes nothing.
 */
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const KB_DIR = path.join(repoRoot, "content", "vehicle-dynamics");
const TUNING_KEYS_FILE = path.join(repoRoot, "src", "lib", "setupComparison", "tuningComparisonKeys.ts");

const wantJson = process.argv.includes("--json");

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
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
      sections.push(titleLine);
      for (const line of lines) {
        if (!/\*\*Keys?(?:\s*\([^)]*\))?:\*\*/.test(line)) continue;
        for (const m of line.matchAll(/`([^`]+)`/g)) {
          const tok = m[1].trim();
          if (!tok || tok.includes(" ") || tok.endsWith(".md")) continue;
          const list = keyToSections.get(tok) || [];
          list.push({ file, section: titleLine });
          keyToSections.set(tok, list);
        }
      }
    }
    fileSections.set(file, sections);
  }
  return { keyToSections, fileSections, files };
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
  const { keys: sheetKeys, prefixes } = loadSheetKeys();

  const kbKeys = new Set(keyToSections.keys());
  const sheetKeysNoKb = [...sheetKeys].filter((k) => !kbKeys.has(k) && !k.endsWith("*")).sort();

  return {
    kbFiles: files,
    fileSections: Object.fromEntries(fileSections),
    kbKeyCount: kbKeys.size,
    kbKeys: [...kbKeys].sort(),
    keyToSections: Object.fromEntries(
      [...keyToSections.entries()].map(([k, v]) => [k, v.map((s) => `${s.file} § ${s.section}`)])
    ),
    sheetKeyCount: sheetKeys.size,
    sheetKeysNoKb,
    sheetPrefixes: prefixes,
  };
}

/* ------------------------------ render ---------------------------------- */

function render(report) {
  const lines = [];
  lines.push("=".repeat(78));
  lines.push("ENGINEER KB COVERAGE / GAP REPORT");
  lines.push("=".repeat(78));
  lines.push("");
  lines.push(`KB-covered keys: ${report.kbKeyCount}   Sheet keys known: ${report.sheetKeyCount}`);
  lines.push("");
  lines.push("KB-COVERED KEYS (from **Keys:** lines):");
  for (const k of report.kbKeys) {
    lines.push(`  ${k}  ->  ${report.keyToSections[k].join(" | ")}`);
  }
  lines.push("");
  lines.push("SHEET KEYS WITH NO KB PROSE AT ALL (need a KB section):");
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
