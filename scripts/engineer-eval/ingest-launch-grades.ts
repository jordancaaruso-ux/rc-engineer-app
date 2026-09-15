/**
 * Score a launch grading export against the goal (memory: engineer-launch-goal-2026-10-01).
 *
 *   npm run engineer:launch:score -- --batch launch-2026-09-09 --grades path/to/export.json
 *
 * The export is the JSON the grading page's Export button writes. Prints: ship rate overall, by
 * context and by shape; every apologise-class flag (any one is a launch blocker); and the list of
 * Not verdicts with the founder's words, which is the work list for the next fix pass. Saves the
 * export beside the answers as grades-<timestamp>.json so a batch keeps its history.
 */
import fs from "node:fs";
import path from "node:path";

type Verdict = { verdict?: "ship" | "not"; flags?: Record<string, boolean>; reason?: string };
type Export = { batch: string; arm: string; exportedAt: string; verdicts: Record<string, Verdict> };
type AnswerFile = { context: string; cases: Record<string, { shape: string; source: string }> };

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const GOAL_SHIP_RATE = 0.9;
const FLAG_LABELS: Record<string, string> = {
  direction: "wrong direction on a knob",
  number: "invented number",
  physics: "physics contradiction",
  outside: "confident outside the KB",
};

function main() {
  const batch = argValue("--batch");
  const gradesPath = argValue("--grades");
  if (!batch || !gradesPath) {
    console.error("Usage: engineer:launch:score -- --batch <name> --grades <export.json>");
    process.exit(1);
  }
  const dir = path.join(__dirname, "answers", batch);
  const exp = JSON.parse(fs.readFileSync(gradesPath, "utf8")) as Export;
  const arm = exp.arm ?? "v1-nets";
  const meta = new Map<string, { shape: string; source: string; context: string }>();
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`${arm}__`) && f.endsWith(".json"))) {
    const a = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AnswerFile;
    for (const [id, c] of Object.entries(a.cases)) meta.set(`${id}__${a.context}`, { shape: c.shape, source: c.source, context: a.context });
  }

  const rows = [...meta.entries()].map(([key, m]) => ({ key, ...m, v: exp.verdicts[key] ?? {} }));
  const graded = rows.filter((r) => r.v.verdict);
  const ship = graded.filter((r) => r.v.verdict === "ship");
  const rate = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);

  console.log(`batch ${batch} · ${arm} · graded ${graded.length} of ${rows.length}`);
  console.log(`SHIP RATE: ${rate(ship.length, graded.length)}   goal ≥ ${Math.round(GOAL_SHIP_RATE * 100)}%`);

  const by = (k: "context" | "shape") => {
    const groups = new Map<string, { n: number; ship: number }>();
    for (const r of graded) {
      const g = groups.get(r[k]) ?? { n: 0, ship: 0 };
      g.n++;
      if (r.v.verdict === "ship") g.ship++;
      groups.set(r[k], g);
    }
    return [...groups.entries()].sort((a, b) => a[1].ship / a[1].n - b[1].ship / b[1].n);
  };
  console.log("\nby context:");
  for (const [k, g] of by("context")) console.log(`  ${k.padEnd(16)} ${rate(g.ship, g.n)}`);
  console.log("by shape (worst first):");
  for (const [k, g] of by("shape")) console.log(`  ${k.padEnd(16)} ${rate(g.ship, g.n)}`);

  const flagged = graded.filter((r) => r.v.flags && Object.values(r.v.flags).some(Boolean));
  console.log(`\nAPOLOGISE CLASS: ${flagged.length} (launch needs 0)`);
  for (const r of flagged) {
    const flags = Object.entries(r.v.flags ?? {}).filter(([, on]) => on).map(([f]) => FLAG_LABELS[f] ?? f);
    console.log(`  ${r.key.padEnd(24)} ${flags.join(", ")}${r.v.reason ? ` — ${r.v.reason}` : ""}`);
  }

  const nots = graded.filter((r) => r.v.verdict === "not");
  console.log(`\nNOT SHIPPING (${nots.length}) — the fix list:`);
  for (const r of nots.sort((a, b) => a.key.localeCompare(b.key))) console.log(`  ${r.key.padEnd(24)} [${r.shape}] ${r.v.reason ?? "(no reason given)"}`);

  const verdict = graded.length === rows.length && ship.length / Math.max(graded.length, 1) >= GOAL_SHIP_RATE && flagged.length === 0;
  console.log(`\nLAUNCH BAR: ${verdict ? "MET" : graded.length < rows.length ? "not yet graded in full" : "NOT MET"}`);

  const saved = path.join(dir, `grades-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(saved, JSON.stringify(exp, null, 1));
  console.log(`saved → ${saved}`);
}

main();
