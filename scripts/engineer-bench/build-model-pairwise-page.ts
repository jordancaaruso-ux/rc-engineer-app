/**
 * Blind pairwise model comparison — the founder is the judge.
 *
 * Takes N bench results files (one per model arm, same `--ids` in each), pairs every arm against
 * every other arm on each shared case, and renders them BLIND: "Answer ①/②", display order
 * flipped deterministically per pair, no model names, no cost, no latency. Founder picks a winner
 * or a tie and says why. Export writes model-pairwise-labels.json for tally-model-pairwise.ts.
 *
 * Why not the calibrated judge: it is gpt-4o grading frontier models, uncalibrated (the current
 * benchmark set ships zero exemplars), and it saturates — 9 of 10 baseline cases scored exactly 9.
 * It cannot separate the arms this compares, so it is not asked to.
 *
 * Nothing here reveals price. A 26x cost gap would otherwise decide the pick before the answers do.
 *
 * Run:  npm run engineer:bench:model-pairwise -- --files=arm-control-55-<stamp>.json,arm-luna-<stamp>.json,...
 *       (no --files → every arm-*.json in results/)
 * Then: open scripts/engineer-bench/results/model-pairwise-page.html
 */
import fs from "node:fs/promises";
import path from "node:path";

type BenchFile = {
  label: string;
  answerModel: string;
  answerEffort: string | null;
  results: Array<{
    id: string;
    question: string;
    answer: string | null;
    error: string | null;
    anchorRunId?: string | null;
    anchorRunLabel?: string | null;
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
  const resultsDir = path.join(process.cwd(), "scripts/engineer-bench/results");
  const filesArg = arg("files");
  const files = filesArg
    ? filesArg.split(",").map((f) => (path.isAbsolute(f.trim()) ? f.trim() : path.join(resultsDir, f.trim())))
    : (await fs.readdir(resultsDir))
        .filter((f) => f.startsWith("arm-") && f.endsWith(".json"))
        .map((f) => path.join(resultsDir, f));

  // An arm is a model AT AN EFFORT, not a model. Keying on the model alone would silently merge
  // luna@high with luna@max into one arm and make an effort sweep unreadable.
  type CaseAnswer = { question: string; answer: string; runId: string | null; runLabel: string | null };
  type Arm = { id: string; byCase: Map<string, CaseAnswer> };
  const arms: Arm[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    let parsed: BenchFile;
    try {
      parsed = JSON.parse(await fs.readFile(f, "utf8")) as BenchFile;
    } catch {
      continue;
    }
    if (!parsed.answerModel || !Array.isArray(parsed.results)) continue;
    const byCase = new Map<string, CaseAnswer>();
    for (const r of parsed.results) {
      if (!r.answer || r.error) continue;
      byCase.set(r.id, {
        question: r.question,
        answer: r.answer,
        runId: r.anchorRunId ?? null,
        runLabel: r.anchorRunLabel ?? null,
      });
    }
    if (byCase.size === 0) continue;
    let id = `${parsed.answerModel}@${parsed.answerEffort ?? "default"}`;
    // Same model AND same effort twice is a legitimate run-to-run noise check — keep both, but
    // make them distinguishable or the tally credits one arm with the other's wins.
    if (seen.has(id)) id = `${id}#${parsed.label}`;
    seen.add(id);
    arms.push({ id, byCase });
  }
  if (arms.length < 2) throw new Error(`Need at least 2 arms with answers; found ${arms.length}`);

  // Only cases every arm answered — a pair where one side errored isn't a comparison.
  const sharedCaseIds = [...arms[0].byCase.keys()].filter((id) => arms.every((a) => a.byCase.has(id)));
  if (sharedCaseIds.length === 0) throw new Error("No case ids common to every arm — did the arms run with the same --ids?");

  type Item = {
    key: string;
    caseId: string;
    question: string;
    runLabel: string | null;
    armA: string;
    armB: string;
    a: string;
    b: string;
    flipped: boolean;
  };
  const items: Item[] = [];
  for (const caseId of sharedCaseIds) {
    // Two arms answering the same case about DIFFERENT runs are not comparable — they were asked
    // about different cars on different days. Say so rather than rendering it as a fair pair.
    const runIds = new Set(arms.map((a) => a.byCase.get(caseId)!.runId ?? "—"));
    if (runIds.size > 1) {
      console.warn(
        `WARNING: case "${caseId}" was answered against different runs across arms (${[...runIds].join(", ")}). Not a like-for-like comparison.`
      );
    }
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const armA = arms[i];
        const armB = arms[j];
        const key = `${armA.id}|${armB.id}|${caseId}`;
        items.push({
          key,
          caseId,
          question: armA.byCase.get(caseId)!.question,
          runLabel: armA.byCase.get(caseId)!.runLabel,
          armA: armA.id,
          armB: armB.id,
          a: armA.byCase.get(caseId)!.answer,
          b: armB.byCase.get(caseId)!.answer,
          flipped: hash(key) % 2 === 1, // flipped → Answer ① is arm B
        });
      }
    }
  }

  // Blind shuffle so the same model doesn't sit in the ① slot run after run.
  const ordered = items
    .map((it) => ({ it, k: hash(`shuf|${it.key}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.it);

  const cards = ordered
    .map((it, i) => {
      const first = it.flipped ? it.b : it.a;
      const second = it.flipped ? it.a : it.b;
      return `
<div class="card show-1" data-key="${esc(it.key)}" data-flipped="${it.flipped ? 1 : 0}" data-case="${esc(it.caseId)}" data-arm-a="${esc(it.armA)}" data-arm-b="${esc(it.armB)}">
  <div class="meta">#${i + 1} of ${ordered.length} · ${esc(it.caseId)}</div>
  <div class="q">${esc(it.question)}</div>
  ${it.runLabel ? `<div class="run"><span>run</span> ${esc(it.runLabel)}</div>` : `<div class="run"><span>run</span> no run attached — this case answers with no session context</div>`}
  <div class="swap">
    <button class="swapbtn sel" data-show="1">Answer ①</button>
    <button class="swapbtn" data-show="2">Answer ②</button>
  </div>
  <div class="answers">
    <div class="ans" data-slot="1"><div class="tag">Answer ①</div><div class="body">${esc(first)}</div></div>
    <div class="ans" data-slot="2"><div class="tag">Answer ②</div><div class="body">${esc(second)}</div></div>
  </div>
  <div class="rate">
    <button class="pick" data-p="1">① better</button>
    <button class="pick" data-p="tie">Tie</button>
    <button class="pick" data-p="2">② better</button>
    <input class="note" placeholder="why — the deciding reason" />
  </div>
</div>`;
    })
    .join("\n");

  const head = `<title>Engineer — blind model pairwise</title>
<style>
  :root { --ground:#121110; --card:#181716; --sunk:#151413; --line:#282726; --line2:#3A3835;
          --ink:#ECE9E4; --body:#C9C6C0; --muted:#A09D96; --faint:#64625E; --accent:#FFD60A; }
  /* Deliberately single-theme: this is a reading surface, and the answers should be the only
     bright thing on it. Matches the app's own dark palette. */
  body { font-family: system-ui, -apple-system, sans-serif; background: var(--ground); color: var(--ink);
         max-width: 1100px; margin: 0 auto; padding: 16px 16px 96px; -webkit-text-size-adjust: 100%; }
  h1 { font-size: 18px; margin: 8px 0; text-wrap: balance; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; line-height: 1.55; max-width: 68ch; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .meta { color: var(--faint); font-size: 11px; margin-bottom: 8px; font-family: ui-monospace, monospace; }
  .q { font-weight: 600; margin-bottom: 8px; white-space: pre-wrap; text-wrap: pretty; }
  .run { font-size: 12px; color: var(--muted); margin-bottom: 12px; line-height: 1.5; border-left: 2px solid var(--line2); padding-left: 10px; }
  .run span { font-family: ui-monospace, monospace; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; margin-right: 6px; }
  .answers { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .ans { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--sunk); }
  .tag { font-family: ui-monospace, monospace; font-size: 12px; color: var(--accent); margin-bottom: 6px; }
  .body { white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: var(--body); overflow-wrap: anywhere; }
  .swap { display: none; gap: 6px; margin-bottom: 10px; }
  .swapbtn { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--sunk);
             color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; }
  .swapbtn.sel { color: var(--ink); border-color: var(--accent); }
  .rate { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .pick { padding: 12px 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--sunk);
          color: var(--ink); font: inherit; cursor: pointer; }
  .pick.sel { background: var(--accent); color: var(--ground); font-weight: 700; border-color: var(--accent); }
  .note { flex: 1; min-width: 220px; background: var(--sunk); border: 1px solid var(--line); border-radius: 8px;
          color: var(--ink); font: inherit; padding: 10px; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .bar { position: sticky; top: 0; background: color-mix(in srgb, var(--ground) 94%, transparent);
         backdrop-filter: blur(8px); padding: 12px 0; display: flex; gap: 8px; align-items: center;
         flex-wrap: wrap; z-index: 2; }
  .export { background: var(--accent); color: var(--ground); font-weight: 700; border: 0; border-radius: 8px;
            padding: 12px 16px; font: inherit; font-weight: 700; cursor: pointer; }
  .ghost { background: var(--sunk); color: var(--ink); border: 1px solid var(--line); border-radius: 8px;
           padding: 12px 16px; font: inherit; cursor: pointer; }
  .progress { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  #out { display: none; width: 100%; min-height: 180px; margin-top: 12px; background: var(--sunk);
         color: var(--body); border: 1px solid var(--line); border-radius: 8px; padding: 10px;
         font-family: ui-monospace, monospace; font-size: 12px; }
  /* Phone: one answer at a time, swapped in place. Flipping between them in the same screen
     position compares far better than scrolling past the first to reach the second. */
  @media (max-width: 820px) {
    .answers { grid-template-columns: 1fr; }
    .swap { display: flex; }
    .card.show-1 .ans[data-slot="2"], .card.show-2 .ans[data-slot="1"] { display: none; }
    .pick { flex: 1; min-width: 92px; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>`;

  const bodyMarkup = `<h1>Engineer — blind model pairwise</h1>
<div class="sub">Same question, two versions, identities hidden — the arms may differ by model, by reasoning effort, or by prompt. Pick the answer you'd rather have got trackside — the right call, honest confidence, no padding — or Tie. Cost and speed are deliberately not shown; they're known and would decide it for you. Skip any pair you don't have a view on. Auto-saves in this browser.</div>
<div class="bar">
  <button class="export" onclick="copyLabels(this)">Copy labels JSON</button>
  <button class="ghost" onclick="exportLabels()">Download</button>
  <span class="progress" id="progress"></span>
</div>
<textarea id="out" readonly aria-label="Labels JSON"></textarea>
${cards}
<script>`;

  const script = `
const KEY = "engineer-model-pairwise-labels";
const store = JSON.parse(localStorage.getItem(KEY) || "{}");
function save() { localStorage.setItem(KEY, JSON.stringify(store)); updateProgress(); }
function updateProgress() {
  const cards = Array.from(document.querySelectorAll(".card"));
  // Count only pairs ON THIS PAGE. localStorage persists across rounds, so counting every stored
  // key would report a fresh round as already complete using a previous round's verdicts.
  const done = cards.filter((c) => store[c.dataset.key] && store[c.dataset.key].pick).length;
  document.getElementById("progress").textContent = done + " / " + cards.length + " labeled";
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
  // Phone view shows one answer at a time; these swap which one occupies the slot.
  card.querySelectorAll(".swapbtn").forEach((btn) => {
    btn.onclick = () => {
      card.querySelectorAll(".swapbtn").forEach((b) => b.classList.remove("sel"));
      btn.classList.add("sel");
      card.classList.remove("show-1", "show-2");
      card.classList.add("show-" + btn.dataset.show);
    };
  });
});
updateProgress();
function labelsJson() {
  const rows = Array.from(document.querySelectorAll(".card")).map((card) => {
    const v = store[card.dataset.key];
    if (!v || !v.pick) return null;
    // Decode display order back to arms here so the tally never has to guess.
    const first = card.dataset.flipped === "1" ? card.dataset.armB : card.dataset.armA;
    const second = card.dataset.flipped === "1" ? card.dataset.armA : card.dataset.armB;
    return {
      caseId: card.dataset.case,
      modelShownFirst: first,
      modelShownSecond: second,
      pick: v.pick,
      winner: v.pick === "tie" ? null : (v.pick === "1" ? first : second),
      note: v.note || null,
    };
  }).filter(Boolean);
  return JSON.stringify({ exportedAtIso: new Date().toISOString(), labels: rows }, null, 2);
}
/**
 * Phone path: downloading a JSON file on a phone and getting it back to the desktop is the
 * awkward step, so the primary action copies to the clipboard instead — paste it straight into
 * chat. Falls back to showing the text when the clipboard API is unavailable (file:// pages).
 */
async function copyLabels(btn) {
  const text = labelsJson();
  const done = (msg) => { const o = btn.textContent; btn.textContent = msg; setTimeout(() => { btn.textContent = o; }, 1800); };
  try {
    await navigator.clipboard.writeText(text);
    done("Copied");
  } catch {
    const out = document.getElementById("out");
    out.style.display = "block";
    out.value = text;
    out.focus();
    out.select();
    done("Select + copy");
  }
}
function exportLabels() {
  const blob = new Blob([labelsJson()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "model-pairwise-labels.json";
  a.click();
}
</script>`;

  // Two shapes from one source: a standalone file for the desktop, and a body-only fragment for
  // publishing (the host supplies its own doctype/head/body, so emitting ours would nest them).
  const standalone = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${head}\n</head><body>\n${bodyMarkup}${script}\n</body></html>`;
  const fragment = `${head}\n${bodyMarkup}${script}\n`;

  const outPath = path.join(resultsDir, "model-pairwise-page.html");
  const fragmentPath = path.join(resultsDir, "model-pairwise-artifact.html");
  await fs.writeFile(outPath, standalone);
  await fs.writeFile(fragmentPath, fragment);
  console.log(`Arms (${arms.length}): ${arms.map((a) => a.id).join(", ")}`);
  console.log(`Shared cases (${sharedCaseIds.length}):`);
  for (const id of sharedCaseIds) {
    console.log(`  ${id.padEnd(30)} ${arms[0].byCase.get(id)!.runLabel ?? "(no run attached)"}`);
  }
  console.log(`Pairwise page: ${outPath} (${ordered.length} comparisons)`);
  console.log(`Publishable fragment: ${fragmentPath}`);
  console.log(`When done, save model-pairwise-labels.json into results/ and run: npm run engineer:bench:model-tally`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
