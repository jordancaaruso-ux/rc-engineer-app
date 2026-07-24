/**
 * Founder pairwise-labeling page — the trust instrument.
 *
 * Renders each scenario's two engine answers BLIND (shown as "Answer ①/②", display
 * order flipped deterministically per scenario; no model names, no grader verdict). The
 * founder picks the better answer + why. Export downloads pairwise-labels.json for
 * ingest-pairwise.ts, which scores grader-vs-founder preference agreement.
 *
 * Run:  npm run engineer:grader:rating-page   (reads results/grader-*.json)
 * Then: open scripts/engineer-grader-eval/results/pairwise-page.html
 */
import fs from "node:fs/promises";
import path from "node:path";

type GraderResults = {
  label: string;
  results: Array<{
    scenarioId: string;
    question: string;
    mode: string;
    engineA: { answer: string | null };
    engineB: { answer: string | null };
  }>;
};

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function main() {
  const resultsDir = path.join(process.cwd(), "scripts/engineer-grader-eval/results");
  const filesArg = arg("files");
  const files = filesArg
    ? filesArg.split(",").map((f) => path.resolve(f.trim()))
    : (await fs.readdir(resultsDir)).filter((f) => f.startsWith("grader-") && f.endsWith(".json")).map((f) => path.join(resultsDir, f));

  type Item = { key: string; scenarioId: string; question: string; mode: string; a: string; b: string; flipped: boolean };
  const items: Item[] = [];
  for (const f of files) {
    let parsed: GraderResults;
    try {
      parsed = JSON.parse(await fs.readFile(f, "utf8")) as GraderResults;
    } catch {
      continue;
    }
    if (!parsed.label || !Array.isArray(parsed.results)) continue;
    for (const r of parsed.results) {
      if (!r.engineA?.answer || !r.engineB?.answer) continue;
      const key = `${parsed.label}|${r.scenarioId}`;
      items.push({
        key,
        scenarioId: r.scenarioId,
        question: r.question,
        mode: r.mode,
        a: r.engineA.answer,
        b: r.engineB.answer,
        flipped: hash(key) % 2 === 1, // flipped → Answer ① is engine B
      });
    }
  }
  if (items.length === 0) throw new Error("No answered pairs found in results/grader-*.json");

  // Blind shuffle so labels don't cluster.
  const ordered = items.map((it) => ({ it, k: hash(`shuf|${it.key}`) })).sort((a, b) => a.k - b.k).map((x) => x.it);

  const cards = ordered
    .map((it, i) => {
      const first = it.flipped ? it.b : it.a; // Answer ①
      const second = it.flipped ? it.a : it.b; // Answer ②
      return `
<div class="card" data-key="${esc(it.key)}" data-flipped="${it.flipped ? 1 : 0}" data-scenario="${esc(it.scenarioId)}">
  <div class="meta">#${i + 1} of ${ordered.length} · mode: ${esc(it.mode)}</div>
  <div class="q">${esc(it.question)}</div>
  <div class="answers">
    <div class="ans"><div class="tag">Answer ①</div><div class="body">${esc(first)}</div></div>
    <div class="ans"><div class="tag">Answer ②</div><div class="body">${esc(second)}</div></div>
  </div>
  <div class="rate">
    <button class="pick" data-p="1">① better</button>
    <button class="pick" data-p="tie">Tie</button>
    <button class="pick" data-p="2">② better</button>
    <input class="note" placeholder="why — the deciding reason (this is what the grader is measured against)" />
  </div>
</div>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Engineer grader — pairwise session</title>
<style>
  body { font-family: system-ui, sans-serif; background: #121110; color: #ECE9E4; max-width: 1040px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 18px; } .sub { color: #A09D96; font-size: 13px; margin-bottom: 20px; }
  .card { background: #181716; border: 1px solid #282726; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .meta { color: #64625E; font-size: 11px; margin-bottom: 8px; font-family: monospace; }
  .q { font-weight: 600; margin-bottom: 12px; white-space: pre-wrap; }
  .answers { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  @media (max-width: 720px) { .answers { grid-template-columns: 1fr; } }
  .ans { border: 1px solid #282726; border-radius: 8px; padding: 10px 12px; background: #151413; }
  .tag { font-family: monospace; font-size: 12px; color: #FFD60A; margin-bottom: 6px; }
  .body { white-space: pre-wrap; font-size: 13px; line-height: 1.5; color: #C9C6C0; }
  .rate { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .pick { padding: 8px 14px; border-radius: 6px; border: 1px solid #282726; background: #151413; color: #ECE9E4; cursor: pointer; }
  .pick.sel { background: #FFD60A; color: #121110; font-weight: 700; }
  .note { flex: 1; min-width: 240px; background: #151413; border: 1px solid #282726; border-radius: 6px; color: #ECE9E4; padding: 6px 8px; }
  .bar { position: sticky; top: 0; background: #121110EE; padding: 12px 0; display: flex; gap: 12px; align-items: center; z-index: 2; }
  .export { background: #FFD60A; color: #121110; font-weight: 700; border: 0; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
  .progress { color: #A09D96; font-size: 13px; }
</style></head><body>
<h1>Engineer grader — pairwise session</h1>
<div class="sub">For each question, pick the answer that reasons better on YOUR scale (diagnosis, right call, prioritization, honest confidence) — or Tie. Blind: you can't see which model wrote which, or what the grader thought. The note is the deciding reason — the grader is scored on matching both your pick and your reasoning. Auto-saves in this browser; export when done (partial is fine).</div>
<div class="bar"><button class="export" onclick="exportLabels()">Export pairwise-labels JSON</button><span class="progress" id="progress"></span></div>
${cards}
<script>
const KEY = "engineer-grader-pairwise-labels";
const store = JSON.parse(localStorage.getItem(KEY) || "{}");
function save() { localStorage.setItem(KEY, JSON.stringify(store)); updateProgress(); }
function updateProgress() {
  const total = document.querySelectorAll(".card").length;
  const done = Object.keys(store).filter((k) => store[k] && store[k].pick).length;
  document.getElementById("progress").textContent = done + " / " + total + " labeled";
}
document.querySelectorAll(".card").forEach((card) => {
  const key = card.dataset.key;
  const saved = store[key];
  card.querySelectorAll(".pick").forEach((btn) => {
    if (saved && btn.dataset.p === saved.pick) btn.classList.add("sel");
    btn.onclick = () => {
      card.querySelectorAll(".pick").forEach((b) => b.classList.remove("sel"));
      btn.classList.add("sel");
      store[key] = Object.assign(store[key] || {}, { pick: btn.dataset.p });
      save();
    };
  });
  const note = card.querySelector(".note");
  if (saved && saved.note) note.value = saved.note;
  note.oninput = () => { store[key] = Object.assign(store[key] || {}, { note: note.value }); save(); };
});
updateProgress();
function exportLabels() {
  const cards = Array.from(document.querySelectorAll(".card"));
  const rows = cards.map((card) => {
    const key = card.dataset.key;
    const v = store[key];
    if (!v || !v.pick) return null;
    const idx = key.lastIndexOf("|");
    return {
      label: key.slice(0, idx),
      scenarioId: card.dataset.scenario,
      flipped: card.dataset.flipped === "1",
      pick: v.pick,           // "1" | "2" | "tie" (display order)
      note: v.note || null,
    };
  }).filter(Boolean);
  const blob = new Blob([JSON.stringify({ exportedAtIso: new Date().toISOString(), labels: rows }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pairwise-labels.json";
  a.click();
}
</script>
</body></html>`;

  const outPath = path.join(resultsDir, "pairwise-page.html");
  await fs.writeFile(outPath, html);
  console.log(`Pairwise page: ${outPath} (${ordered.length} pairs from ${files.length} results files)`);
  console.log(`When done, export pairwise-labels.json into results/ and run: npm run engineer:grader:ingest`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
