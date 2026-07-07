/**
 * Founder rating page — validates the AI judge (iteration engine, blueprint E).
 *
 * Renders bench answers as a single self-contained HTML page for a blind rating
 * session: question + answer only (no judge scores visible), 0–10 per answer,
 * optional note, progress saved to localStorage across sittings. "Export ratings"
 * downloads a JSON file for ingest-ratings.ts, which computes judge-vs-founder
 * Pearson — the number that decides whether the judge can be trusted to gate
 * iterations.
 *
 * Run:  npm run engineer:bench:rating-page -- --files=results/a.json,results/b.json
 *       (omit --files to include every results/*.json bench run)
 * Then: open scripts/engineer-bench/results/rating-page.html in a browser.
 */
import fs from "node:fs/promises";
import path from "node:path";

type ResultsFile = {
  label: string;
  results: Array<{
    id: string;
    mode: string;
    question: string;
    answer: string | null;
  }>;
};

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  const resultsDir = path.join(process.cwd(), "scripts/engineer-bench/results");
  let files: string[];
  const filesArg = arg("files");
  if (filesArg) {
    files = filesArg.split(",").map((f) => path.resolve(f.trim()));
  } else {
    files = (await fs.readdir(resultsDir))
      .filter((f) => f.endsWith(".json") && !f.startsWith("pairwise-") && !f.startsWith("founder-ratings"))
      .map((f) => path.join(resultsDir, f));
  }

  type Item = { label: string; id: string; mode: string; question: string; answer: string };
  const items: Item[] = [];
  for (const f of files) {
    let parsed: ResultsFile;
    try {
      parsed = JSON.parse(await fs.readFile(f, "utf8")) as ResultsFile;
    } catch {
      continue;
    }
    if (!parsed.label || !Array.isArray(parsed.results)) continue;
    for (const r of parsed.results) {
      if (!r.answer) continue;
      items.push({ label: parsed.label, id: r.id, mode: r.mode, question: r.question, answer: r.answer });
    }
  }
  if (items.length === 0) throw new Error("No answered bench cases found");

  // Deterministic shuffle (seeded by key) so run labels don't cluster — keeps the
  // session blind to which pipeline version produced which answer.
  const keyed = items
    .map((it) => ({ it, k: hash(`${it.label}|${it.id}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.it);

  const cards = keyed
    .map((it, i) => {
      const key = `${it.label}|${it.id}`;
      return `
<div class="card" data-key="${esc(key)}">
  <div class="meta">#${i + 1} of ${keyed.length} · mode: ${esc(it.mode)}</div>
  <div class="q">${esc(it.question)}</div>
  <div class="a">${esc(it.answer)}</div>
  <div class="rate">
    ${Array.from({ length: 11 }, (_, s) => `<button class="star" data-s="${s}">${s}</button>`).join("")}
    <input class="note" placeholder="optional note — why this score" />
  </div>
</div>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Engineer bench — founder rating session</title>
<style>
  body { font-family: system-ui, sans-serif; background: #121110; color: #ECE9E4; max-width: 860px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 18px; } .sub { color: #A09D96; font-size: 13px; margin-bottom: 20px; }
  .card { background: #181716; border: 1px solid #282726; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .meta { color: #64625E; font-size: 11px; margin-bottom: 8px; font-family: monospace; }
  .q { font-weight: 600; margin-bottom: 10px; white-space: pre-wrap; }
  .a { white-space: pre-wrap; font-size: 14px; line-height: 1.5; color: #C9C6C0; border-left: 2px solid #282726; padding-left: 12px; margin-bottom: 12px; }
  .rate { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
  .star { width: 34px; height: 30px; border-radius: 6px; border: 1px solid #282726; background: #151413; color: #ECE9E4; cursor: pointer; }
  .star.sel { background: #FFD60A; color: #121110; font-weight: 700; }
  .note { flex: 1; min-width: 200px; background: #151413; border: 1px solid #282726; border-radius: 6px; color: #ECE9E4; padding: 6px 8px; }
  .bar { position: sticky; top: 0; background: #121110EE; padding: 12px 0; display: flex; gap: 12px; align-items: center; z-index: 2; }
  .export { background: #FFD60A; color: #121110; font-weight: 700; border: 0; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
  .progress { color: #A09D96; font-size: 13px; }
</style></head><body>
<h1>Engineer bench — founder rating session</h1>
<div class="sub">Rate each answer 0–10 on your scale (0 useless · 5 mediocre · 8 genuinely useful · 10 top human engineer). Blind: judge scores are hidden. Progress auto-saves in this browser — you can close and come back. Export when done (partial exports are fine too).</div>
<div class="bar"><button class="export" onclick="exportRatings()">Export ratings JSON</button><span class="progress" id="progress"></span></div>
${cards}
<script>
const KEY = "engineer-bench-founder-ratings";
const store = JSON.parse(localStorage.getItem(KEY) || "{}");
function save() { localStorage.setItem(KEY, JSON.stringify(store)); updateProgress(); }
function updateProgress() {
  const total = document.querySelectorAll(".card").length;
  const done = Object.keys(store).filter((k) => store[k] && typeof store[k].stars === "number").length;
  document.getElementById("progress").textContent = done + " / " + total + " rated";
}
document.querySelectorAll(".card").forEach((card) => {
  const key = card.dataset.key;
  const saved = store[key];
  card.querySelectorAll(".star").forEach((btn) => {
    if (saved && Number(btn.dataset.s) === saved.stars) btn.classList.add("sel");
    btn.onclick = () => {
      card.querySelectorAll(".star").forEach((b) => b.classList.remove("sel"));
      btn.classList.add("sel");
      store[key] = Object.assign(store[key] || {}, { stars: Number(btn.dataset.s) });
      save();
    };
  });
  const note = card.querySelector(".note");
  if (saved && saved.note) note.value = saved.note;
  note.oninput = () => { store[key] = Object.assign(store[key] || {}, { note: note.value }); save(); };
});
updateProgress();
function exportRatings() {
  const rows = Object.entries(store)
    .filter(([, v]) => v && typeof v.stars === "number")
    .map(([k, v]) => {
      const idx = k.lastIndexOf("|");
      return { label: k.slice(0, idx), id: k.slice(idx + 1), stars: v.stars, note: v.note || null };
    });
  const blob = new Blob([JSON.stringify({ exportedAtIso: new Date().toISOString(), ratings: rows }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "founder-ratings.json";
  a.click();
}
</script>
</body></html>`;

  const outPath = path.join(resultsDir, "rating-page.html");
  await fs.writeFile(outPath, html);
  console.log(`Rating page: ${outPath} (${keyed.length} answers from ${files.length} results files)`);
  console.log(`When done, export founder-ratings.json into scripts/engineer-bench/results/ and run: npm run engineer:bench:pearson`);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
