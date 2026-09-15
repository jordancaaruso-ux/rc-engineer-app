/**
 * Build the launch grading page — ship or not, one conversation at a time.
 *
 *   npm run engineer:launch:page -- --batch launch-2026-09-09 [--arm v1-nets]
 *
 * Reads answers/<batch>/<arm>__<context>.json for every context present and writes
 * answers/<batch>/grading-page.html. Unlike the pairwise page this is an ABSOLUTE grade (founder
 * call 2026-09-09: launch is decided by "would I stand behind this", not by A beating B): each
 * conversation shows the context the Engineer was given, every turn, and two buttons — Ship, or
 * Not — with a few words when it is Not. Verdicts live in localStorage keyed by batch so a closed
 * tab loses nothing; the Export button writes the verdicts as JSON into a textarea to paste back.
 *
 * The apologise class (auto-fail regardless of taste) is a checkbox list under "Not": wrong
 * direction on a knob · invented number · physics contradiction · confident outside the KB.
 */
import fs from "node:fs";
import path from "node:path";

type Turn = { role: "user" | "assistant"; content: string };
type AnswerFile = {
  arm: string;
  context: string;
  batch: string;
  promptVersion: string;
  fixture: string | null;
  cases: Record<string, { shape: string; source: string; turns: Turn[] }>;
};

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Minimal markdown: **bold**, bullets, paragraphs. The Engineer's replies use nothing else. */
function md(s: string): string {
  const lines = esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const l of lines) {
    const m = l.match(/^\s*[-•]\s+(.*)$/);
    if (m) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${m[1]}</li>`);
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      if (l.trim()) out.push(`<p>${l}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function main() {
  const batch = argValue("--batch");
  if (!batch) {
    console.error("Usage: engineer:launch:page -- --batch <name> [--arm v1-nets]");
    process.exit(1);
  }
  const arm = argValue("--arm") ?? "v1-nets";
  const dir = path.join(__dirname, "answers", batch);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${arm}__`) && f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AnswerFile);
  if (files.length === 0) throw new Error(`No ${arm}__*.json answer files in ${dir}`);

  type Card = { key: string; id: string; shape: string; source: string; context: string; fixture: string | null; turns: Turn[] };
  const cards: Card[] = [];
  for (const f of files) {
    for (const [id, c] of Object.entries(f.cases)) {
      cards.push({ key: `${id}__${f.context}`, id, shape: c.shape, source: c.source, context: f.context, fixture: f.fixture, turns: c.turns });
    }
  }
  // Same case back to back across contexts, so the driver-data difference is visible.
  cards.sort((a, b) => (a.id === b.id ? a.context.localeCompare(b.context) : a.id.localeCompare(b.id)));

  const cardHtml = cards
    .map((c, i) => {
      const ctx = c.fixture
        ? `<details class="ctx"><summary>Context: ${esc(c.context)} — what the Engineer was given</summary><pre>${esc(c.fixture)}</pre></details>`
        : `<div class="ctx none">Context: nothing — no runs logged</div>`;
      const turns = c.turns
        .map((t) => `<div class="turn ${t.role}"><div class="who">${t.role === "user" ? "Driver" : "Engineer"}</div><div class="body">${t.role === "user" ? `<p>${esc(t.content)}</p>` : md(t.content)}</div></div>`)
        .join("");
      return `<section class="card" data-key="${esc(c.key)}" id="c${i}">
  <div class="head"><span class="n">${i + 1} / ${cards.length}</span> <span class="id">${esc(c.id)}</span> <span class="shape">${esc(c.shape)}</span> <span class="src">${c.source === "driver" ? "another driver" : "founder"}</span></div>
  ${ctx}
  ${turns}
  <div class="grade">
    <button class="ship" data-v="ship">Ship</button>
    <button class="not" data-v="not">Not</button>
    <span class="state"></span>
    <div class="why">
      <label><input type="checkbox" data-flag="direction"> wrong direction on a knob</label>
      <label><input type="checkbox" data-flag="number"> invented number</label>
      <label><input type="checkbox" data-flag="physics"> physics contradiction</label>
      <label><input type="checkbox" data-flag="outside"> confident outside the KB</label>
      <input type="text" class="reason" placeholder="a few words on why not">
    </div>
  </div>
</section>`;
    })
    .join("\n");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Engineer launch grading — ${esc(batch)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.45 system-ui, sans-serif; margin: 0; background: #EAE7E0; color: #1a1a1a; }
  header { position: sticky; top: 0; background: #1a1a1a; color: #fff; padding: 10px 16px; display: flex; gap: 16px; align-items: center; z-index: 2; }
  header b { font-size: 17px; } header .tally { margin-left: auto; font-variant-numeric: tabular-nums; }
  header button { background: #F2C230; border: 0; padding: 6px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; }
  main { max-width: 860px; margin: 0 auto; padding: 16px; }
  .card { background: #fff; border-radius: 10px; padding: 14px 16px; margin: 0 0 18px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .card.done-ship { border-left: 6px solid #2e8b57; } .card.done-not { border-left: 6px solid #c0392b; }
  .head { display: flex; gap: 10px; font-size: 13px; color: #666; margin-bottom: 8px; } .head .id { font-weight: 700; color: #1a1a1a; }
  .head .shape { background: #eee; padding: 0 8px; border-radius: 10px; }
  .ctx { font-size: 13px; color: #555; margin: 6px 0 10px; } .ctx pre { white-space: pre-wrap; background: #f6f5f1; padding: 8px; border-radius: 6px; max-height: 260px; overflow: auto; }
  .ctx.none { font-style: italic; }
  .turn { display: grid; grid-template-columns: 76px 1fr; gap: 8px; padding: 8px 0; border-top: 1px solid #eee; }
  .turn .who { font-weight: 700; font-size: 13px; color: #666; } .turn.user .body p { font-weight: 600; }
  .turn .body p { margin: 0 0 6px; } .turn .body ul { margin: 4px 0 6px 18px; padding: 0; }
  .grade { border-top: 1px solid #eee; padding-top: 10px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .grade button { padding: 8px 18px; border-radius: 6px; border: 0; font-weight: 700; cursor: pointer; }
  .grade .ship { background: #2e8b57; color: #fff; } .grade .not { background: #c0392b; color: #fff; }
  .grade .state { font-size: 13px; color: #666; }
  .why { display: none; width: 100%; gap: 10px 14px; flex-wrap: wrap; font-size: 13px; } .card.done-not .why { display: flex; }
  .why .reason { flex: 1 1 260px; padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font: inherit; }
  textarea#export { width: 100%; height: 160px; font: 12px/1.3 monospace; margin-top: 8px; }
  @media (max-width: 480px) { .turn { grid-template-columns: 1fr; } .head { flex-wrap: wrap; } }
</style></head><body>
<header><b>Engineer launch grading</b> <span>${esc(batch)} · ${esc(arm)}</span> <span class="tally" id="tally"></span> <button id="export-btn">Export</button></header>
<main>
<p style="color:#555;font-size:13px">One grade per conversation: <b>Ship</b> if you would stand behind every Engineer turn as a paying driver's answer; <b>Not</b> otherwise, ticking any apologise-class fault and a few words. A conversation that ends on a question ships if that is the right question to ask. Progress is saved in this browser.</p>
${cardHtml}
<section class="card"><div class="head"><span class="id">Export</span></div><p style="font-size:13px;color:#555">Press Export in the header, then copy this box back to the session.</p><textarea id="export" readonly></textarea></section>
</main>
<script>
(function () {
  var KEY = "engineer-launch-grading:" + ${JSON.stringify(batch)} + ":" + ${JSON.stringify(arm)};
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { state = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} tally(); }
  function tally() {
    var keys = Object.keys(state), ship = 0, not = 0;
    keys.forEach(function (k) { if (state[k].verdict === "ship") ship++; else if (state[k].verdict === "not") not++; });
    var total = document.querySelectorAll(".card[data-key]").length;
    document.getElementById("tally").textContent = (ship + not) + " / " + total + " graded · ship " + ship + " · not " + not;
  }
  function paint(card) {
    var s = state[card.dataset.key] || {};
    card.classList.toggle("done-ship", s.verdict === "ship");
    card.classList.toggle("done-not", s.verdict === "not");
    card.querySelector(".state").textContent = s.verdict ? (s.verdict === "ship" ? "shipped" : "not shipping") : "";
    card.querySelectorAll("input[data-flag]").forEach(function (cb) { cb.checked = !!(s.flags && s.flags[cb.dataset.flag]); });
    card.querySelector(".reason").value = s.reason || "";
  }
  document.querySelectorAll(".card[data-key]").forEach(function (card) {
    var key = card.dataset.key;
    paint(card);
    card.querySelectorAll(".grade button").forEach(function (b) {
      b.addEventListener("click", function () {
        state[key] = state[key] || {};
        state[key].verdict = b.dataset.v;
        save(); paint(card);
        if (b.dataset.v === "ship") { var next = card.nextElementSibling; if (next && next.dataset.key) next.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    });
    card.querySelectorAll("input[data-flag]").forEach(function (cb) {
      cb.addEventListener("change", function () { state[key] = state[key] || {}; state[key].flags = state[key].flags || {}; state[key].flags[cb.dataset.flag] = cb.checked; save(); });
    });
    card.querySelector(".reason").addEventListener("input", function (e) { state[key] = state[key] || {}; state[key].reason = e.target.value; save(); });
  });
  document.getElementById("export-btn").addEventListener("click", function () {
    document.getElementById("export").value = JSON.stringify({ batch: ${JSON.stringify(batch)}, arm: ${JSON.stringify(arm)}, exportedAt: new Date().toISOString(), verdicts: state }, null, 1);
    document.getElementById("export").scrollIntoView({ behavior: "smooth" });
  });
  tally();
})();
</script>
</body></html>`;

  const outPath = path.join(dir, "grading-page.html");
  fs.writeFileSync(outPath, html);
  console.log(`${cards.length} conversations → ${outPath}`);
}

main();
