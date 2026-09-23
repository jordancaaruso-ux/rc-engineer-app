// Score one naming run against a regex answer key.
//   node score-gold.cjs <gold.cjs> <workDir> [--verbose]
// Reads <workDir>/labels-a.json, labels-b.json (merged passes) and review.json (assembled).
const fs = require("fs");
const path = require("path");
const [goldPath, dir] = process.argv.slice(2);
const verbose = process.argv.includes("--verbose");
const gold = require(path.resolve(goldPath));

const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const text = (l) => [l.displayLabel, l.optionLabel].filter(Boolean).join(" ");
const judge = (g, s) => g.all.every((r) => r.test(s)) && !g.none.some((r) => r.test(s));

function scorePass(file) {
  const j = read(file);
  if (!j) return null;
  const byName = new Map((j.fields || j).map((l) => [l.name, l]));
  const out = { firm: 0, firmOk: 0, loose: 0, looseOk: 0, wrong: [] };
  for (const [name, g] of Object.entries(gold)) {
    const l = byName.get(name);
    if (!l) continue;
    const ok = judge(g, text(l));
    if (g.tier === "firm") { out.firm++; if (ok) out.firmOk++; }
    else { out.loose++; if (ok) out.looseOk++; }
    if (!ok) out.wrong.push(`${name.padEnd(22)} want "${g.canon}"  got "${text(l)}" (${(l.confidence ?? 0).toFixed(2)})`);
  }
  return out;
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
for (const pass of ["a", "b"]) {
  const s = scorePass(path.join(dir, `labels-${pass}.json`));
  if (!s) continue;
  console.log(`pass ${pass.toUpperCase()}: firm ${s.firmOk}/${s.firm} (${pct(s.firmOk, s.firm)})   loose ${s.looseOk}/${s.loose}`);
  if (verbose) for (const w of s.wrong) console.log(`   x ${w}`);
}

const review = read(path.join(dir, "review.json"));
if (review) {
  let ready = 0, readyOk = 0, readyWrong = [], firmTotal = 0, firmReadyOk = 0;
  for (const g of Object.values(gold)) if (g.tier === "firm") firmTotal++;
  for (const r of review.rows) {
    const g = gold[r.pdfName];
    if (!g || r.verdict !== "ready") continue;
    ready++;
    const ok = judge(g, r.chosen || "");
    if (ok) { readyOk++; if (g.tier === "firm") firmReadyOk++; }
    else readyWrong.push(`${r.pdfName.padEnd(22)} want "${g.canon}"  shipped "${r.chosen}"`);
  }
  console.log(`assembled: ${ready} ready on answer-key boxes, ${readyOk} right (precision ${pct(readyOk, ready)}); firm boxes shipped right ${firmReadyOk}/${firmTotal} (${pct(firmReadyOk, firmTotal)})`);
  for (const w of readyWrong) console.log(`   SHIPPED WRONG ${w}`);
}
