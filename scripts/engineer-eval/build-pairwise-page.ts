/**
 * Build the blind pairwise rating page — Jordan's picks are the harness's ground truth.
 *
 *   npm run engineer:eval:page -- --batch 2026-08-14 --arms v1,v1-nets [--seed 42]
 *
 * Reads answers/<batch>/<arm>.json for the two arms, writes answers/<batch>/rating-page.html.
 * Left/right order is shuffled per question with a seeded PRNG; the page never shows arm
 * identity, and the export embeds batch/arms/seed so ingest-founder-ratings.ts can
 * de-shuffle. Verdicts accumulate in localStorage (keyed by batch) so the page survives a
 * closed tab.
 */
import fs from "node:fs";
import path from "node:path";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

// Deterministic PRNG (mulberry32) so the shuffle is reproducible from the seed alone.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type AnswerFile = {
  arm: string;
  answers: Record<string, { question: string; archetype: string; reply: string }>;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  const batch = argValue("--batch");
  const armsArg = argValue("--arms");
  const seedNum = Number(argValue("--seed") ?? "1");
  if (!batch || !armsArg || armsArg.split(",").length !== 2) {
    console.error("Usage: engineer:eval:page -- --batch <name> --arms <armA>,<armB> [--seed N]");
    process.exit(1);
  }
  const [armA, armB] = armsArg.split(",").map((s) => s.trim());
  const dir = path.join(__dirname, "answers", batch);
  const a = JSON.parse(fs.readFileSync(path.join(dir, `${armA}.json`), "utf8")) as AnswerFile;
  const b = JSON.parse(fs.readFileSync(path.join(dir, `${armB}.json`), "utf8")) as AnswerFile;

  const rand = mulberry32(seedNum);
  const ids = Object.keys(a.answers).filter((id) => b.answers[id]);

  const items = ids.map((id) => {
    const aFirst = rand() < 0.5;
    return {
      id,
      question: a.answers[id].question,
      archetype: a.answers[id].archetype,
      left: aFirst ? a.answers[id].reply : b.answers[id].reply,
      right: aFirst ? b.answers[id].reply : a.answers[id].reply,
      aFirst,
    };
  });

  const meta = { batch, armA, armB, seed: seedNum };

  const cards = items
    .map(
      (it, i) => `
  <section class="card" data-id="${esc(it.id)}">
    <h2>${i + 1} / ${items.length} — <code>${esc(it.id)}</code> <small>${esc(it.archetype)}</small></h2>
    <p class="q">${esc(it.question)}</p>
    <div class="pair">
      <div class="ans"><h3>Answer 1</h3><pre>${esc(it.left)}</pre></div>
      <div class="ans"><h3>Answer 2</h3><pre>${esc(it.right)}</pre></div>
    </div>
    <div class="verdict">
      <button data-v="left">Answer 1 wins</button>
      <button data-v="tie">Tie</button>
      <button data-v="right">Answer 2 wins</button>
      <input type="text" placeholder="one line: why?" class="reason" />
      <span class="saved"></span>
    </div>
  </section>`
    )
    .join("\n");

  const html = `<!doctype html>
<meta charset="utf-8" />
<title>Engineer blind pairwise — ${esc(batch)}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 24px; background: #111; color: #eee; }
  .card { border: 1px solid #333; border-radius: 10px; padding: 16px; margin-bottom: 28px; }
  .q { font-weight: 600; font-size: 16px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ans pre { white-space: pre-wrap; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px; font: 13px/1.45 inherit; }
  .verdict { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  button { padding: 6px 14px; border-radius: 8px; border: 1px solid #444; background: #222; color: #eee; cursor: pointer; }
  button.on { background: #2f6f3f; border-color: #3f8f4f; }
  .reason { flex: 1; min-width: 220px; padding: 6px 10px; border-radius: 8px; border: 1px solid #444; background: #1a1a1a; color: #eee; }
  .saved { color: #7c7; font-size: 12px; }
  #bar { position: sticky; top: 0; background: #111; padding: 10px 0; display: flex; gap: 12px; align-items: center; border-bottom: 1px solid #333; margin-bottom: 20px; z-index: 2; }
  #export { background: #2b4f7f; border-color: #3b6f9f; }
  small { color: #999; font-weight: 400; }
  code { color: #9cf; }
</style>
<div id="bar">
  <strong>Engineer blind pairwise</strong>
  <span id="progress"></span>
  <button id="export">Export ratings JSON</button>
</div>
${cards}
<script>
const META = ${JSON.stringify(meta)};
const KEY = "engineer-eval-" + META.batch + "-" + META.armA + "-" + META.armB;
const state = JSON.parse(localStorage.getItem(KEY) || "{}");

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  const total = document.querySelectorAll(".card").length;
  const done = Object.values(state).filter((s) => s && s.verdict).length;
  document.getElementById("progress").textContent = done + " / " + total + " rated";
}

document.querySelectorAll(".card").forEach((card) => {
  const id = card.dataset.id;
  const entry = state[id] || {};
  const reasonEl = card.querySelector(".reason");
  reasonEl.value = entry.reason || "";
  const paint = () => {
    card.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === (state[id] || {}).verdict));
    card.querySelector(".saved").textContent = (state[id] || {}).verdict ? "saved" : "";
  };
  card.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      state[id] = { verdict: b.dataset.v, reason: reasonEl.value };
      paint();
      save();
    })
  );
  reasonEl.addEventListener("input", () => {
    if (state[id]) { state[id].reason = reasonEl.value; save(); }
  });
  paint();
});
save();

document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob(
    [JSON.stringify({ meta: META, ratings: state }, null, 2)],
    { type: "application/json" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "founder-ratings-" + META.batch + ".json";
  a.click();
});
</script>`;

  const outPath = path.join(dir, "rating-page.html");
  fs.writeFileSync(outPath, html);
  console.log(`${items.length} pairs → ${outPath}`);
  console.log("Open it in a browser, rate blind, then Export and run engineer:eval:ingest on the download.");
}

void main();
