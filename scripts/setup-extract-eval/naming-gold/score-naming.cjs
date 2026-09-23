// Score a namer's output (v1 or v2 shape) against a hand-named gold map.
// node score-naming.cjs <result.json> <gold.json> [--verbose]
const fs = require("fs");
const [resultPath, goldPath] = process.argv.slice(2);
const verbose = process.argv.includes("--verbose");
const r = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const { gold } = JSON.parse(fs.readFileSync(goldPath, "utf8"));

const STOP = new Set(["the", "a", "an", "of", "mm", "deg", "degrees", "cst", "g", "front", "rear", "fr", "rr", "f", "r", "left", "right", "l", "side", "setting", "type", "value", "option", "position", "mount", "mounting"]);
const AX = { front: "front", fr: "front", f: "front", rear: "rear", rr: "rear", r: "rear", bk: "rear" };
const optNorm = (s) => { const t = String(s || "").toLowerCase().replace(/^f_/, "").replace(/_/g, " ").replace(/o ring/g, "oring").replace(/[^a-z0-9. ]+/g, " ").trim(); const d = t.replace(/[^0-9]/g, ""); return d.length ? d : t.replace(/\s+/g, " "); };
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9%°.]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter(Boolean);
const axle = (s) => { const w = words(s); for (const x of w) if (AX[x]) return AX[x]; return null; };
const core = (s) => new Set(words(s).filter((w) => !STOP.has(w)));
const STEM = { "castor": "caster", "bodyshell": "body", "motormount": "motor", "inside": "inner", "outside": "outer", "ht": "height", "spacers": "shim", "spacer": "shim", "shims": "shim", "spacers": "spacer", "springs": "spring", "tyres": "tyre", "tires": "tyre", "tire": "tyre", "weights": "weight", "shocks": "shock", "damper": "shock", "dampers": "shock", "oil": "oil", "arb": "antiroll", "anti": "antiroll", "roll": "", "bar": "", "sway": "antiroll", "ride": "ride", "height": "height", "rh": "rideheight", "fdr": "fdr", "final": "fdr", "drive": "fdr", "ratio": "", "gear": "", "diff": "diff", "differential": "diff", "camber": "camber", "caster": "caster", "toe": "toe", "droop": "droop", "downstop": "droop", "piston": "piston", "pistons": "piston", "hole": "", "holes": "" };
const stem = (set) => new Set([...set].map((w) => (w in STEM ? STEM[w] : w)).filter(Boolean));

function match(goldLabel, ourLabel) {
  const g = stem(core(goldLabel)), o = stem(core(ourLabel));
  if (g.size === 0 || o.size === 0) return norm(goldLabel) === norm(ourLabel) ? "same" : "diff";
  const shared = [...g].filter((w) => o.has(w)).length;
  const ga = axle(goldLabel), oa = axle(ourLabel);
  const axleOk = !ga || !oa || ga === oa;
  if (shared === g.size && axleOk) return "same";
  if (shared / g.size >= 0.5 && axleOk) return "close";
  return "diff";
}

// Build ours: pdfFieldName -> { label, options: {instanceIndex: label}, optionLabel }
const ours = new Map();
const fieldsByKey = new Map(r.draftedSchema.fields.map((f) => [f.key, f]));
for (const [key, rule] of Object.entries(r.formFieldMappings)) {
  const f = fieldsByKey.get(key);
  if (!f) continue;
  if (rule.mode === "singleChoiceWidgetGroup" || rule.mode === "multiSelectWidgetGroup") {
    ours.set(rule.pdfFieldName, { label: f.displayLabel, options: Object.fromEntries(Object.entries(rule.options).map(([v, x]) => [x.widgetInstanceIndex, v])), conf: f.confidence });
  } else if (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields") {
    for (const [v, x] of Object.entries(rule.options)) ours.set(x.pdfFieldName, { label: f.displayLabel, optionLabel: v, conf: f.confidence });
  } else if (rule.pdfFieldName) {
    ours.set(rule.pdfFieldName, { label: f.displayLabel, conf: f.confidence, options: f.options && f.options.length === 1 ? { 0: f.options[0] } : undefined });
  }
}

const tally = { same: 0, close: 0, diff: 0, missing: 0 };
const byConf = { hi: { n: 0, same: 0 }, lo: { n: 0, same: 0 } };
let optTotal = 0, optOk = 0;
const diffs = [];
for (const [pdfName, g] of Object.entries(gold)) {
  const o = ours.get(pdfName);
  if (!o) { tally.missing++; continue; }
  const goldLabel = g.optionLabel ? `${g.label} ${g.optionLabel}` : g.label;
  const ourLabel = o.optionLabel ? `${o.label} ${o.optionLabel}` : o.label;
  const m = match(goldLabel, ourLabel);
  tally[m]++;
  if (o.conf != null) { const b = o.conf >= 0.8 ? byConf.hi : byConf.lo; b.n++; if (m === "same") b.same++; }
  if (m !== "same") diffs.push(`${m.padEnd(5)} ${pdfName.padEnd(14)} gold="${goldLabel}"  ours="${ourLabel}"${o.conf != null ? ` (${o.conf.toFixed(2)})` : ""}`);
  if (g.options && o.options) {
    for (const [idx, gl] of Object.entries(g.options)) { optTotal++; const ol = o.options[idx]; if (ol && optNorm(ol) === optNorm(gl)) optOk++; else if (verbose) diffs.push(`  opt   ${pdfName}#${idx} gold="${gl}" ours="${ol ?? "-"}"`); }
  }
}
const n = tally.same + tally.close + tally.diff;
console.log(`${resultPath.split(/[\\/]/).pop()} vs ${goldPath.split(/[\\/]/).pop()}: same ${tally.same}/${n} (${((tally.same / n) * 100).toFixed(0)}%)  close ${tally.close}  diff ${tally.diff}  missing ${tally.missing}  | options exact ${optOk}/${optTotal}` + (byConf.hi.n ? ` | conf≥0.8: ${byConf.hi.same}/${byConf.hi.n} same; conf<0.8: ${byConf.lo.same}/${byConf.lo.n}` : ""));
if (verbose) console.log(diffs.join("\n"));
