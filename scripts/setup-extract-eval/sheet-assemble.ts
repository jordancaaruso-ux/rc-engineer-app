/**
 * Turn two independent naming passes into one shippable answer.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/sheet-assemble.ts --work=<sheetDir> [--min-confidence=0.8]
 *
 * A name is kept only when both passes said the same thing (or close enough) AND both were
 * confident. That rule measured 98-100% right on the two hand-named sheets, and everything it
 * rejects stays unnamed rather than wrong.
 *
 * Writes result-a.json, result-b.json, ready.json (the kept names) and review.json (every box with
 * both passes' answers, for the review page).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { draftBlankV2, type V2Result, type V2Field } from "./draft-blank-v2";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

// ---------- do two labels mean the same thing? ----------

const STOP = new Set(["the", "a", "an", "of", "mm", "deg", "degrees", "cst", "g", "front", "rear", "fr", "rr", "f", "r", "left", "right", "l", "side", "setting", "type", "value", "option", "position", "mount", "mounting"]);
const AX: Record<string, string> = { front: "front", fr: "front", f: "front", rear: "rear", rr: "rear", r: "rear", bk: "rear" };
const STEM: Record<string, string> = { castor: "caster", bodyshell: "body", motormount: "motor", inside: "inner", outside: "outer", ht: "height", spacers: "shim", spacer: "shim", shims: "shim", springs: "spring", tyres: "tyre", tires: "tyre", tire: "tyre", weights: "weight", shocks: "shock", damper: "shock", dampers: "shock", arb: "antiroll", anti: "antiroll", roll: "", bar: "", sway: "antiroll", rh: "rideheight", fdr: "fdr", final: "fdr", drive: "fdr", ratio: "", gear: "", differential: "diff", pistons: "piston", hole: "", holes: "" };

const norm = (s: string) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9%°.]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);
const axleOf = (s: string) => { for (const w of words(s)) if (AX[w]) return AX[w]; return null; };
const core = (s: string) => new Set(words(s).filter((w) => !STOP.has(w)));
const stem = (set: Set<string>) => new Set([...set].map((w) => (w in STEM ? STEM[w] : w)).filter(Boolean));

export function agreement(a: string, b: string): "same" | "close" | "diff" {
  const x = stem(core(a)), y = stem(core(b));
  if (x.size === 0 || y.size === 0) return norm(a) === norm(b) ? "same" : "diff";
  const shared = [...x].filter((w) => y.has(w)).length;
  const ax = axleOf(a), ay = axleOf(b);
  if (ax && ay && ax !== ay) return "diff";
  const denom = Math.max(x.size, y.size);
  if (shared === denom) return "same";
  if (shared / denom >= 0.5) return "close";
  return "diff";
}

// ---------- merge one pass's batch files ----------

function mergeLabels(dir: string, order: string[]): { fields: unknown[]; missing: string[]; batches: number } {
  if (!existsSync(dir)) return { fields: [], missing: order, batches: 0 };
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const byName = new Map<string, Record<string, unknown>>();
  for (const f of files) {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch (e) { console.log(`  bad JSON in ${f}: ${(e as Error).message}`); continue; }
    const list = Array.isArray(parsed) ? parsed : ((parsed as { fields?: unknown[] }).fields ?? []);
    for (const l of list as Array<Record<string, unknown>>) if (l && typeof l.name === "string") byName.set(l.name, l);
  }
  return { fields: order.map((n) => byName.get(n)).filter(Boolean) as unknown[], missing: order.filter((n) => !byName.has(n)), batches: files.length };
}

async function run(dir: string, sheet: { name: string; discipline?: string; pdf: string }, pass: "a" | "b", order: string[]) {
  const merged = mergeLabels(join(dir, `labels-${pass}`), order);
  console.log(`pass ${pass.toUpperCase()}: ${merged.batches} batch files, ${merged.fields.length}/${order.length} boxes named${merged.missing.length ? `; MISSING ${merged.missing.length}: ${merged.missing.slice(0, 12).join(", ")}${merged.missing.length > 12 ? " …" : ""}` : ""}`);
  const labelsPath = join(dir, `labels-${pass}.json`);
  writeFileSync(labelsPath, JSON.stringify({ fields: merged.fields }, null, 1));
  const result = await draftBlankV2({
    pdfBytes: readFileSync(sheet.pdf), carName: sheet.name, apiKey: "", model: `opus-5 (pass ${pass.toUpperCase()})`,
    perCall: 8, concurrency: 1, scale: 3, labelsPath, log: () => {},
  });
  if (!result) throw new Error(`pass ${pass} produced no result`);
  writeFileSync(join(dir, `result-${pass}.json`), JSON.stringify(result, null, 1));
  return { result, missing: merged.missing };
}

async function main() {
  const dir = arg("work");
  if (!dir) throw new Error("need --work=<sheetDir>");
  const minConf = Number(arg("min-confidence") ?? 0.8);
  const sheet = JSON.parse(readFileSync(join(dir, "sheet.json"), "utf8")) as { name: string; discipline?: string; pdf: string; fields: number };
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { fields: Array<{ name: string }> };
  const order = manifest.fields.map((f) => f.name);

  const a = await run(dir, sheet, "a", order);
  const b = await run(dir, sheet, "b", order);

  const fieldsA = a.result.draftedSchema.fields as V2Field[];
  const fieldsB = b.result.draftedSchema.fields as V2Field[];
  const byPdfName = (fs: V2Field[]) => {
    const m = new Map<string, V2Field>();
    for (const f of fs) for (const n of f.pdfFieldNames) if (!m.has(n)) m.set(n, f);
    return m;
  };
  const mapA = byPdfName(fieldsA), mapB = byPdfName(fieldsB);

  const rows: Array<Record<string, unknown>> = [];
  const tally = { ready: 0, disagree: 0, lowConfidence: 0, onlyOnePass: 0 };
  const seen = new Set<string>();
  for (const name of order) {
    const fa = mapA.get(name), fb = mapB.get(name);
    const key = fa?.key ?? fb?.key ?? name;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!fa || !fb) { tally.onlyOnePass++; rows.push({ pdfName: name, key, verdict: "one-pass-only", a: fa?.displayLabel ?? null, b: fb?.displayLabel ?? null }); continue; }
    const verdictWord = agreement(fa.displayLabel, fb.displayLabel);
    const confOk = fa.confidence >= minConf && fb.confidence >= minConf;
    const agree = verdictWord !== "diff";
    const ready = agree && confOk;
    if (ready) tally.ready++;
    else if (!agree) tally.disagree++;
    else tally.lowConfidence++;
    const winner = fa.confidence >= fb.confidence ? fa : fb;
    rows.push({
      pdfName: name, key, verdict: ready ? "ready" : !agree ? "disagree" : "low-confidence",
      agreement: verdictWord, a: fa.displayLabel, b: fb.displayLabel,
      confA: fa.confidence, confB: fb.confidence,
      printedLabel: fa.printedLabel || fb.printedLabel, section: winner.section,
      chosen: ready ? winner.displayLabel : null,
      universalParameterId: ready ? (winner.universalParameterId ?? null) : null,
      options: winner.options ?? null,
    });
  }

  const ready: V2Result = { ...a.result, draftedSchema: { ...a.result.draftedSchema, fields: fieldsA.filter((f) => rows.some((r) => r.key === f.key && r.verdict === "ready")) as V2Field[] } };
  writeFileSync(join(dir, "ready.json"), JSON.stringify(ready, null, 1));
  writeFileSync(join(dir, "review.json"), JSON.stringify({ car: sheet.name, boxes: rows.length, tally, minConfidence: minConf, rows }, null, 1));

  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(0)}%`;
  console.log(`\n${sheet.name}: ${rows.length} boxes`);
  console.log(`  ready (both passes agree, both >= ${minConf})  ${tally.ready}  ${pct(tally.ready)}`);
  console.log(`  disagree                                      ${tally.disagree}  ${pct(tally.disagree)}`);
  console.log(`  agreed but not confident                      ${tally.lowConfidence}  ${pct(tally.lowConfidence)}`);
  if (tally.onlyOnePass) console.log(`  only one pass named it                        ${tally.onlyOnePass}`);
}

main();
